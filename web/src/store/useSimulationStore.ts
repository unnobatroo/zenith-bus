import { create } from 'zustand';

import { CacheLineSimulator, type CacheEvent, type LineSnapshot } from '../core/CacheLineSimulator';
import { EventBusSimulator, type BusSnapshot } from '../core/EventBusSimulator';
import type { BufferSlotState, MemoryStep } from '../core/types';
import initZenith, { type ZenithModule } from '../wasm/zenith';

// --- Live WASM module (the real compiled zenith::SPSCQueue / EventBus) ---

let api: ZenithModule | null = null;
const cacheSim = new CacheLineSimulator();
const bus = new EventBusSimulator();

let ringSeq = 0;
let lastPopped: number | undefined;
let ringProduceAcc = 0;
let ringConsumeAcc = 0;
let cacheAcc = 0;

const LOG_LIMIT = 40;

interface RingIndices {
    head: number;
    tail: number;
    cachedHead: number;
    cachedTail: number;
}

function probe(): RingIndices {
    const m = api!;
    return {
        head: m._zq_head(),
        tail: m._zq_tail(),
        cachedHead: m._zq_cached_head(),
        cachedTail: m._zq_cached_tail(),
    };
}

interface RingSnap {
    slots: BufferSlotState<number>[];
    ringCapacity: number;
    headSlot: number;
    tailSlot: number;
    head: number;
    tail: number;
    ringDepth: number;
    lastPopped?: number;
}

function emptyRingSnap(): RingSnap {
    return {
        slots: [],
        ringCapacity: 8,
        headSlot: 0,
        tailSlot: 0,
        head: 0,
        tail: 0,
        ringDepth: 0,
    };
}

function ringSnapshot(): RingSnap {
    const m = api!;
    const cap = m._zq_capacity();
    const head = m._zq_head();
    const tail = m._zq_tail();
    const depth = Math.min(tail - head, cap);
    const mask = cap - 1;
    const headSlot = head & mask;
    const slots: BufferSlotState<number>[] = [];
    for (let i = 0; i < cap; ++i) {
        const occupied = ((i - headSlot) & mask) < depth;
        slots.push({
            index: i,
            occupied,
            isHead: i === headSlot && depth > 0,
            isTail: i === (tail & mask) && depth < cap,
            value: occupied ? m._zq_slot_value(i) : undefined,
        });
    }
    return {
        slots,
        ringCapacity: cap,
        headSlot,
        tailSlot: tail & mask,
        head,
        tail,
        ringDepth: depth,
        lastPopped,
    };
}

// Build the memory-op narrative from REAL before/after internal state.
// A changed cached index means the corresponding acquire reload genuinely
// fired inside the compiled C++.
function describePush(before: RingIndices, after: RingIndices, ok: boolean): MemoryStep[] {
    const mask = api!._zq_capacity() - 1;
    const steps: MemoryStep[] = [
        { op: 'relaxed_load', target: 'tail_', detail: 'tail = tail_.load(relaxed)' },
    ];
    if (after.cachedHead !== before.cachedHead) {
        steps.push({
            op: 'cache_reload',
            target: 'cached_head_',
            detail: `queue looked full — cached_head_ = head_.load(acquire) → ${after.cachedHead}`,
        });
    }
    if (!ok) {
        steps.push({ op: 'rejected', target: 'tail_', detail: 'still full → try_push returned false' });
        return steps;
    }
    steps.push({
        op: 'slot_write',
        target: 'slot',
        slot: before.tail & mask,
        detail: `storage_[tail & ${mask}] = item  (slot ${before.tail & mask})`,
    });
    steps.push({
        op: 'release_store',
        target: 'tail_',
        detail: `tail_.store(${after.tail}, release) — publishes the slot write`,
    });
    return steps;
}

function describePop(before: RingIndices, after: RingIndices, ok: boolean): MemoryStep[] {
    const mask = api!._zq_capacity() - 1;
    const steps: MemoryStep[] = [
        { op: 'relaxed_load', target: 'head_', detail: 'head = head_.load(relaxed)' },
    ];
    if (after.cachedTail !== before.cachedTail) {
        steps.push({
            op: 'cache_reload',
            target: 'cached_tail_',
            detail: `queue looked empty — cached_tail_ = tail_.load(acquire) → ${after.cachedTail}`,
        });
    }
    if (!ok) {
        steps.push({ op: 'rejected', target: 'head_', detail: 'still empty → try_pop returned false' });
        return steps;
    }
    steps.push({
        op: 'slot_read',
        target: 'slot',
        slot: before.head & mask,
        detail: `item = storage_[head & ${mask}]  (slot ${before.head & mask})`,
    });
    steps.push({
        op: 'release_store',
        target: 'head_',
        detail: `head_.store(${after.head}, release) — publishes the slot read`,
    });
    return steps;
}

function cacheSnapshot() {
    const s = cacheSim.snapshot();
    return {
        padded: cacheSim.padded,
        cacheLines: s.lines,
        cacheEvents: s.events,
        invalidations: cacheSim.invalidations,
        transfers: cacheSim.transfers,
        cacheHits: cacheSim.hits,
    };
}

interface SimulationStore extends RingSnap {
    ready: boolean;
    init: () => Promise<void>;

    // Ring playground
    memLog: MemoryStep[];
    autoProducer: boolean;
    autoConsumer: boolean;
    producerHz: number;
    consumerHz: number;

    pushItem: () => void;
    popItem: () => void;
    setRingCapacity: (n: number) => void;
    toggleAutoProducer: () => void;
    toggleAutoConsumer: () => void;
    setProducerHz: (hz: number) => void;
    setConsumerHz: (hz: number) => void;
    resetRing: () => void;

    // Cache inspector
    padded: boolean;
    cacheLines: LineSnapshot[];
    cacheEvents: CacheEvent[];
    invalidations: number;
    transfers: number;
    cacheHits: number;
    autoCache: boolean;

    concurrentStep: () => void;
    togglePadding: () => void;
    toggleAutoCache: () => void;
    resetCache: () => void;

    // Event bus
    busSnap: BusSnapshot;
    busRunning: boolean;
    busProducerHz: number;

    playBus: () => void;
    pauseBus: () => void;
    resetBus: () => void;
    setBusProducerHz: (hz: number) => void;
    setDrainHz: (id: string, hz: number) => void;

    tick: (dtMs: number) => void;
}

export const useSimulationStore = create<SimulationStore>((set, get) => {
    const doPush = (): MemoryStep[] => {
        const m = api!;
        const before = probe();
        const ok = m._zq_push(ringSeq) === 1;
        const steps = describePush(before, probe(), ok);
        if (ok) ringSeq += 1;
        return steps;
    };
    const doPop = (): MemoryStep[] => {
        const m = api!;
        const before = probe();
        const v = m._zq_pop();
        const steps = describePop(before, probe(), v !== -1);
        if (v !== -1) lastPopped = v;
        return steps;
    };

    return {
        ready: false,
        ...emptyRingSnap(),
        memLog: [],
        autoProducer: false,
        autoConsumer: false,
        producerHz: 2,
        consumerHz: 2,

        init: async () => {
            if (api) return;
            api = await initZenith();
            api._zq_set_capacity(8);
            bus.bind(api);
            set({ ready: true, ...ringSnapshot(), busSnap: bus.snapshot() });
        },

        pushItem: () => {
            if (!api) return;
            const steps = doPush();
            set((s) => ({ ...ringSnapshot(), memLog: [...steps, ...s.memLog].slice(0, LOG_LIMIT) }));
        },
        popItem: () => {
            if (!api) return;
            const steps = doPop();
            set((s) => ({ ...ringSnapshot(), memLog: [...steps, ...s.memLog].slice(0, LOG_LIMIT) }));
        },
        setRingCapacity: (n) => {
            if (!api) return;
            api._zq_set_capacity(n);
            ringSeq = 0;
            lastPopped = undefined;
            set({ ...ringSnapshot(), memLog: [] });
        },
        toggleAutoProducer: () => set((s) => ({ autoProducer: !s.autoProducer })),
        toggleAutoConsumer: () => set((s) => ({ autoConsumer: !s.autoConsumer })),
        setProducerHz: (hz) => set({ producerHz: hz }),
        setConsumerHz: (hz) => set({ consumerHz: hz }),
        resetRing: () => {
            if (!api) return;
            api._zq_reset();
            ringSeq = 0;
            lastPopped = undefined;
            set({ ...ringSnapshot(), memLog: [] });
        },

        ...cacheSnapshot(),
        autoCache: false,

        concurrentStep: () => {
            cacheSim.concurrentStep();
            set(cacheSnapshot());
        },
        togglePadding: () => {
            cacheSim.setPadded(!cacheSim.padded);
            set(cacheSnapshot());
        },
        toggleAutoCache: () => set((s) => ({ autoCache: !s.autoCache })),
        resetCache: () => {
            cacheSim.reset();
            set(cacheSnapshot());
        },

        busSnap: bus.snapshot(),
        busRunning: false,
        busProducerHz: 200,

        playBus: () => set({ busRunning: true }),
        pauseBus: () => set({ busRunning: false }),
        resetBus: () => {
            bus.reset();
            set({ busSnap: bus.snapshot() });
        },
        setBusProducerHz: (hz) => {
            bus.producerHz = hz;
            set({ busProducerHz: hz });
        },
        setDrainHz: (id, hz) => {
            bus.setDrainHz(id, hz);
            set({ busSnap: bus.snapshot() });
        },

        tick: (dtMs) => {
            if (!api) return;
            const dt = dtMs / 1000;
            const patch: Partial<SimulationStore> = {};
            const { autoProducer, autoConsumer, producerHz, consumerHz, autoCache, busRunning } = get();

            if (autoProducer || autoConsumer) {
                const steps: MemoryStep[] = [];
                if (autoProducer) {
                    ringProduceAcc += producerHz * dt;
                    while (ringProduceAcc >= 1) {
                        ringProduceAcc -= 1;
                        steps.push(...doPush());
                        if (api._zq_size() >= api._zq_capacity()) ringProduceAcc = 0;
                    }
                }
                if (autoConsumer) {
                    ringConsumeAcc += consumerHz * dt;
                    while (ringConsumeAcc >= 1) {
                        ringConsumeAcc -= 1;
                        const had = api._zq_size() > 0;
                        steps.push(...doPop());
                        if (!had) ringConsumeAcc = 0;
                    }
                }
                Object.assign(patch, ringSnapshot());
                if (steps.length > 0) {
                    patch.memLog = [...steps, ...get().memLog].slice(0, LOG_LIMIT);
                }
            }

            if (autoCache) {
                cacheAcc += dt * 10; // ~10 concurrent steps/sec
                while (cacheAcc >= 1) {
                    cacheAcc -= 1;
                    cacheSim.concurrentStep();
                }
                Object.assign(patch, cacheSnapshot());
            }

            if (busRunning) {
                bus.tick(dtMs);
                patch.busSnap = bus.snapshot();
            }

            set(patch);
        },
    };
});
