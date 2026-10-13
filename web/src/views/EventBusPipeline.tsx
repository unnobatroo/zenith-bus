import { Pause, Play, RotateCcw } from 'lucide-react';

import { Panel, PanelTitle, Stat, TechButton, TechSlider } from '../components/primitives';
import { ThroughputChart } from '../components/ThroughputChart';
import { useSimulationStore } from '../store/useSimulationStore';
import { cn } from '../lib/utils';

const ACCENT: Record<string, string> = {
    teal: '#0F766E',
    ochre: '#B45309',
    indigo: '#4338CA',
};

export function EventBusPipeline() {
    const s = useSimulationStore();
    const b = s.busSnap;
    return (
        <div className="flex flex-col gap-4">
            <Panel>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <PanelTitle>Producer — TelemetryPacket stream</PanelTitle>
                    <div className="flex items-center gap-2">
                        {s.busRunning ? (
                            <TechButton onClick={s.pauseBus}><Pause size={14} /> Pause</TechButton>
                        ) : (
                            <TechButton variant="producer" onClick={s.playBus}><Play size={14} /> Run</TechButton>
                        )}
                        <TechButton onClick={s.resetBus}><RotateCcw size={14} /> Reset</TechButton>
                    </div>
                </div>
                <div className="mt-2 max-w-md">
                    <TechSlider
                        label="producer rate"
                        value={s.busProducerHz}
                        min={10}
                        max={2000}
                        step={10}
                        onChange={s.setBusProducerHz}
                        format={(v) => `${v}/s`}
                    />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Stat label="published" value={b.produced} accent="#2563EB" />
                    <Stat label="delivered" value={b.delivered} accent="#0F766E" />
                    <Stat label="dropped" value={b.dropped} accent={b.dropped > 0 ? '#B45309' : '#0F766E'} />
                    <Stat
                        label="p50 / p99 latency"
                        value={`${b.p50Ms.toFixed(0)} / ${b.p99Ms.toFixed(0)}`}
                        unit="ms sim"
                    />
                </div>
                <div className="mt-3">
                    <span className="label-tech">throughput (packets/sec)</span>
                    <ThroughputChart history={b.throughputHistory} />
                </div>
                {b.lastPacket && (
                    <div className="mt-3 border border-rule bg-parchment p-2 font-mono text-[11px] text-body">
                        last: seq={b.lastPacket.seq} speed={b.lastPacket.vehicleSpeedMps.toFixed(1)} m/s
                        steer={b.lastPacket.steeringRad.toFixed(2)} rad yaw={b.lastPacket.yawRateRad.toFixed(2)} rad/s
                    </div>
                )}
            </Panel>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {b.subscribers.map((sub) => (
                    <Panel key={sub.id}>
                        <div className="flex items-center justify-between">
                            <PanelTitle>{sub.name}</PanelTitle>
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: ACCENT[sub.accent] }}
                            />
                        </div>
                        <div className="mb-1 flex justify-between font-mono text-[10px] text-caption">
                            <span>occupancy</span>
                            <span>{sub.occupancy}/{sub.capacity}</span>
                        </div>
                        <div className="h-2 w-full border border-rule-strong bg-parchment">
                            <div
                                className={cn('h-full transition-[width] duration-150', sub.occupancy === sub.capacity && 'animate-pulse')}
                                style={{
                                    width: `${(sub.occupancy / sub.capacity) * 100}%`,
                                    backgroundColor: sub.occupancy === sub.capacity ? '#B45309' : ACCENT[sub.accent],
                                }}
                            />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <Stat label="received" value={sub.received} accent={ACCENT[sub.accent]} />
                            <Stat label="dropped" value={sub.dropped} accent={sub.dropped > 0 ? '#B45309' : '#73736C'} />
                        </div>
                        <div className="mt-3">
                            <TechSlider
                                label="drain rate"
                                value={sub.drainHz}
                                min={10}
                                max={1500}
                                step={10}
                                onChange={(v) => s.setDrainHz(sub.id, v)}
                                format={(v) => `${v}/s`}
                            />
                        </div>
                    </Panel>
                ))}
            </div>
        </div>
    );
}
