// Simplified two-core MESI model over two 64-byte cache lines.
//
// Core 0 is the producer (owns tail_), Core 1 is the consumer (owns head_).
// With `alignas(64)` the indices sit on separate lines and never contend.
// Unpadded, they share Line 0 and every write invalidates the peer's copy —
// the "false sharing" ping-pong this simulator counts and animates.

export type MesiState = 'M' | 'E' | 'S' | 'I';
export type CoreId = 0 | 1;

export interface LineSnapshot {
    id: number;
    addressRange: string;
    /** Variable names occupying the line. */
    vars: string[];
    core0: MesiState;
    core1: MesiState;
    /** Ticks remaining on the invalidation-flash animation. */
    flash: number;
}

export interface CacheEvent {
    tick: number;
    line: number;
    kind: 'invalidation' | 'transfer' | 'hit';
    detail: string;
}

const CORE_NAME: Record<CoreId, string> = { 0: 'Core 0 (producer)', 1: 'Core 1 (consumer)' };

export class CacheLineSimulator {
    padded = false;
    tick = 0;
    invalidations = 0;
    transfers = 0;
    hits = 0;

    /** MESI state per line per core. */
    private mesi: [MesiState, MesiState][] = [
        ['I', 'I'],
        ['I', 'I'],
    ];
    private flash = [0, 0];
    private eventLog: CacheEvent[] = [];

    setPadded(padded: boolean) {
        if (this.padded === padded) return;
        this.padded = padded;
        this.reset();
    }

    /** Clears MESI state and counters, keeping the current layout mode. */
    reset() {
        this.mesi = [
            ['I', 'I'],
            ['I', 'I'],
        ];
        this.flash = [0, 0];
        this.eventLog = [];
        this.invalidations = 0;
        this.transfers = 0;
        this.hits = 0;
    }

    /** Which cache line a variable lives on. */
    lineOf(variable: 'head_' | 'tail_' | 'cached_peer'): number {
        if (!this.padded) return 0; // head_ and tail_ share line 0
        return variable === 'head_' ? 0 : 1; // tail_ (and cached_head_) on line 1
    }

    /** A core reads a variable. Returns events generated. */
    read(core: CoreId, variable: 'head_' | 'tail_' | 'cached_peer'): CacheEvent[] {
        const line = this.lineOf(variable);
        const events: CacheEvent[] = [];
        const mine = this.mesi[line][core];
        if (mine === 'I') {
            const other = 1 - core as CoreId;
            const wasModified = this.mesi[line][other] === 'M';
            this.mesi[line][core] = 'S';
            this.mesi[line][other] = wasModified ? 'S' : this.mesi[line][other];
            this.transfers += 1;
            events.push({
                tick: this.tick,
                line,
                kind: 'transfer',
                detail: `${CORE_NAME[core]} misses on ${variable} — line ${line} pulled into Shared`,
            });
        } else {
            this.hits += 1;
            events.push({
                tick: this.tick,
                line,
                kind: 'hit',
                detail: `${CORE_NAME[core]} hits local cache for ${variable}`,
            });
        }
        return events;
    }

    /** A core writes its owned variable. Returns events generated. */
    write(core: CoreId, variable: 'head_' | 'tail_' | 'cached_peer'): CacheEvent[] {
        const line = this.lineOf(variable);
        const events: CacheEvent[] = [];
        const other = 1 - core as CoreId;
        if (this.mesi[line][other] !== 'I') {
            this.mesi[line][other] = 'I';
            this.invalidations += 1;
            this.flash[line] = 6;
            events.push({
                tick: this.tick,
                line,
                kind: 'invalidation',
                detail: `${CORE_NAME[core]} writes ${variable} → line ${line} invalidated in the other core's L1`,
            });
        }
        this.mesi[line][core] = 'M';
        return events;
    }

    /** One simulated concurrent step: producer writes tail_, consumer writes head_. */
    concurrentStep(): CacheEvent[] {
        this.tick += 1;
        const events = [
            ...this.write(0, 'tail_'),
            ...this.read(1, 'tail_'),
            ...this.write(1, 'head_'),
            ...this.read(0, 'head_'),
        ];
        for (let i = 0; i < this.flash.length; ++i) {
            this.flash[i] = Math.max(0, this.flash[i] - 1);
        }
        this.eventLog.push(...events);
        if (this.eventLog.length > 200) this.eventLog.splice(0, this.eventLog.length - 200);
        return events;
    }

    snapshot(): { lines: LineSnapshot[]; events: CacheEvent[] } {
        const vars = this.padded
            ? [['head_ (8B)', 'consumer-owned'], ['tail_ (8B)', 'cached_head_ (8B)', 'producer-owned']]
            : [['head_ (8B)', 'tail_ (8B)', 'shared!'], []];
        return {
            lines: [0, 1].map((id) => ({
                id,
                addressRange: id === 0 ? '0x00 – 0x3F' : '0x40 – 0x7F',
                vars: vars[id],
                core0: this.mesi[id][0],
                core1: this.mesi[id][1],
                flash: this.flash[id],
            })),
            events: this.eventLog,
        };
    }
}
