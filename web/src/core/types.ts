// Domain types shared by the simulation core and the UI.

export type MemoryOpKind =
    | 'relaxed_load'
    | 'acquire_load'
    | 'release_store'
    | 'slot_write'
    | 'slot_read'
    | 'cache_reload'
    | 'rejected';

export interface MemoryStep {
    op: MemoryOpKind;
    /** Which machine-level entity the op touches. */
    target: 'tail_' | 'head_' | 'cached_head_' | 'cached_tail_' | 'slot';
    slot?: number;
    detail: string;
}

export interface BufferSlotState<T = unknown> {
    index: number;
    occupied: boolean;
    isHead: boolean;
    isTail: boolean;
    value?: T;
}

export interface OpResult<T = unknown> {
    success: boolean;
    item?: T;
    memoryOps: MemoryStep[];
}

export interface TelemetryPacket {
    seq: number;
    timestampMs: number;
    vehicleSpeedMps: number;
    steeringRad: number;
    yawRateRad: number;
}
