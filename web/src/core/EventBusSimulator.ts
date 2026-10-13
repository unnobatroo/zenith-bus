import type { ZenithModule } from '../wasm/zenith';
import type { TelemetryPacket } from './types';

export interface SubscriberSpec {
    id: string;
    name: string;
    /** Packets drained per second. */
    drainHz: number;
    accent: 'teal' | 'ochre' | 'indigo';
}

export interface SubscriberSnapshot {
    id: string;
    name: string;
    accent: 'teal' | 'ochre' | 'indigo';
    occupancy: number;
    capacity: number;
    received: number;
    dropped: number;
    drainHz: number;
}

export interface BusSnapshot {
    tickMs: number;
    produced: number;
    delivered: number;
    dropped: number;
    subscribers: SubscriberSnapshot[];
    /** Rolling producer throughput, packets/sec — last ~60 s of history. */
    throughputHistory: number[];
    p50Ms: number;
    p99Ms: number;
    lastPacket?: TelemetryPacket;
}

const LATENCY_WINDOW = 512;

/**
 * Timing/scheduling driver around the REAL zenith::EventBus compiled to
 * WASM. Rates, packet synthesis and statistics live here; every queue
 * operation goes through the compiled C++.
 */
export class EventBusSimulator {
    readonly queueCapacity = 16;
    producerHz = 200;
    private api: ZenithModule | null = null;
    private specs: SubscriberSpec[];
    private produced = 0;
    private delivered = 0;
    private dropped = 0;
    private received: number[];
    private droppedPerQueue: number[];
    private seq = 0;
    private tickMs = 0;
    private produceAcc = 0;
    private drainAccs: number[];
    private latencies: number[] = [];
    private producedThisSecond = 0;
    private throughputHistory: number[] = [];
    private lastPacket?: TelemetryPacket;

    constructor(specs?: SubscriberSpec[]) {
        this.specs = specs ?? [
            { id: 'safety', name: 'Safety Monitor', drainHz: 1000, accent: 'teal' },
            { id: 'logger', name: 'Disk Logger', drainHz: 60, accent: 'ochre' },
            { id: 'ui', name: 'UI Renderer', drainHz: 250, accent: 'indigo' },
        ];
        this.drainAccs = this.specs.map(() => 0);
        this.received = this.specs.map(() => 0);
        this.droppedPerQueue = this.specs.map(() => 0);
    }

    /** Attach the loaded WASM module and subscribe each consumer. */
    bind(api: ZenithModule) {
        this.api = api;
        api._zb_reset();
        this.specs.forEach(() => api._zb_subscribe());
    }

    tick(dtMs: number) {
        const api = this.api;
        if (!api) return;
        this.tickMs += dtMs;
        const dt = dtMs / 1000;

        this.produceAcc += this.producerHz * dt;
        while (this.produceAcc >= 1) {
            this.produceAcc -= 1;
            const packet = this.makePacket();
            this.produced += 1;
            this.producedThisSecond += 1;
            this.lastPacket = packet;
            const r = api._zb_publish(
                packet.seq, packet.timestampMs,
                packet.vehicleSpeedMps, packet.steeringRad, packet.yawRateRad,
            );
            const fullMask = r >> 1;
            for (let i = 0; i < this.specs.length; ++i) {
                if (fullMask & (1 << i)) {
                    this.dropped += 1;
                    this.droppedPerQueue[i] += 1;
                } else {
                    this.delivered += 1;
                }
            }
        }

        this.specs.forEach((_, i) => {
            this.drainAccs[i] += this.specs[i].drainHz * dt;
            while (this.drainAccs[i] >= 1) {
                this.drainAccs[i] -= 1;
                const n = api._zb_drain(i);
                if (n === 0) break;
                this.received[i] += n;
                for (let j = 0; j < n; ++j) {
                    const ts = api._zb_drain_ts(j);
                    if (ts >= 0) {
                        this.latencies.push(this.tickMs - ts);
                        if (this.latencies.length > LATENCY_WINDOW) this.latencies.shift();
                    }
                }
            }
        });

        if (this.tickMs % 1000 < dtMs) {
            this.throughputHistory.push(this.producedThisSecond);
            this.producedThisSecond = 0;
            if (this.throughputHistory.length > 60) this.throughputHistory.shift();
        }
    }

    setDrainHz(id: string, hz: number) {
        const spec = this.specs.find((s) => s.id === id);
        if (spec) spec.drainHz = hz;
    }

    reset() {
        this.api?._zb_reset();
        if (this.api) this.specs.forEach(() => this.api!._zb_subscribe());
        this.drainAccs = this.specs.map(() => 0);
        this.received = this.specs.map(() => 0);
        this.droppedPerQueue = this.specs.map(() => 0);
        this.produced = 0;
        this.delivered = 0;
        this.dropped = 0;
        this.seq = 0;
        this.produceAcc = 0;
        this.latencies = [];
        this.throughputHistory = [];
        this.producedThisSecond = 0;
        this.lastPacket = undefined;
    }

    private makePacket(): TelemetryPacket {
        const t = this.tickMs / 1000;
        return {
            seq: this.seq++,
            timestampMs: this.tickMs,
            vehicleSpeedMps: 12 + 8 * Math.sin(t * 0.7) + Math.random() * 0.4,
            steeringRad: 0.35 * Math.sin(t * 1.9),
            yawRateRad: 0.2 * Math.cos(t * 1.2),
        };
    }

    snapshot(): BusSnapshot {
        const api = this.api;
        const sorted = [...this.latencies].sort((a, b) => a - b);
        const pick = (q: number) =>
            sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
        return {
            tickMs: this.tickMs,
            produced: this.produced,
            delivered: this.delivered,
            dropped: this.dropped,
            subscribers: this.specs.map((s, i) => ({
                id: s.id,
                name: s.name,
                accent: s.accent,
                occupancy: api ? api._zb_occupancy(i) : 0,
                capacity: this.queueCapacity,
                received: this.received[i],
                dropped: this.droppedPerQueue[i],
                drainHz: s.drainHz,
            })),
            throughputHistory: [...this.throughputHistory],
            p50Ms: pick(0.5),
            p99Ms: pick(0.99),
            lastPacket: this.lastPacket,
        };
    }
}
