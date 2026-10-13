// Type declarations for the Emscripten-generated module (zenith.js/zenith.wasm).
// C exports surface as Module._name with number/BigInt-free signatures.

export interface ZenithModule {
    // SPSC playground queue
    _zq_set_capacity(capacity: number): void;
    _zq_reset(): void;
    _zq_push(value: number): number;
    _zq_pop(): number;
    _zq_head(): number;
    _zq_tail(): number;
    _zq_cached_head(): number;
    _zq_cached_tail(): number;
    _zq_size(): number;
    _zq_capacity(): number;
    _zq_slot_value(i: number): number;

    // Event bus
    _zb_reset(): void;
    _zb_subscribe(): number;
    _zb_publish(seq: number, ts: number, speed: number, steer: number, yaw: number): number;
    _zb_drain(sub: number): number;
    _zb_drain_ts(i: number): number;
    _zb_last_field(sub: number, field: number): number;
    _zb_occupancy(sub: number): number;
    _zb_subscriber_count(): number;
}

declare const factory: (moduleArg?: Record<string, unknown>) => Promise<ZenithModule>;
export default factory;
