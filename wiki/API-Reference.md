# API Reference

All symbols live in namespace `zenith`. Headers: `zenith/concepts.hpp`,
`zenith/spsc_queue.hpp`, `zenith/event_bus.hpp`.

## `zenith::TriviallyRelocatable`

```cpp
template <typename T>
concept TriviallyRelocatable =
    std::is_trivially_copyable_v<T> && std::is_standard_layout_v<T>;
```

Constrains every payload type. Trivially copyable means the bits can be
moved with `memcpy` semantics — the ring buffer needs no per-slot
constructors or destructors, keeping push/pop to a few instructions. Plain
structs, PODs, and fixed arrays qualify; `std::string`, `std::vector`, and
`unique_ptr` payloads do not (wrap them in an owning handle yourself).

## `zenith::SPSCQueue<T, Capacity>`

Requires `TriviallyRelocatable<T>`; `Capacity` is a compile-time power of
two ≥ 2 (`static_assert`ed).

```cpp
zenith::SPSCQueue<TelemetryPacket, 1024> queue;
```

| Member | Signature | Semantics |
|---|---|---|
| `try_push` | `bool try_push(const T&) noexcept` / `bool try_push(T&&) noexcept` | Enqueues; `false` if full. Wait-free bounded — never blocks. |
| `try_pop` | `bool try_pop(T& out) noexcept` | Dequeues into `out`; `false` if empty. |
| `size_approx` | `size_t size_approx() const noexcept` | Approximate depth — indices move concurrently, so treat as a hint. |
| `empty` | `bool empty() const noexcept` | `size_approx() == 0`. |

Thread contract: **exactly one** producer thread may call `try_push`, and
**exactly one** consumer thread may call `try_pop`. `size_approx`/`empty`
may be called from either side. Non-copyable, non-movable.

## `zenith::EventBus<T, QueueCapacity, MaxSubscribers = 8>`

```cpp
zenith::EventBus<TelemetryPacket, 1024> bus;          // 8 subscriber slots
zenith::EventBus<TelemetryPacket, 1024, 16> big_bus;  // up to 16
```

| Member | Signature | Semantics |
|---|---|---|
| `subscribe` | `[[nodiscard]] size_t subscribe()` | Reserves a dedicated queue; returns the subscriber handle (0-based). Throws `std::length_error` past `MaxSubscribers`. Call during setup, before publishing. |
| `publish` | `bool publish(const T&) noexcept` | One non-blocking `try_push` per subscriber queue. `false` means at least one queue was full — that subscriber drops the event; others still receive it. |
| `publish_wait` | `void publish_wait(const T&) noexcept` | Guaranteed fan-out: spins (yielding) until every queue accepts. Blocks if a subscriber stops draining. |
| `poll` | `bool poll(size_t sub_id, T& out) noexcept` | Pops one event for subscriber `sub_id`; `false` on empty or invalid handle. |
| `drain` | `template <Callback> size_t drain(size_t sub_id, Callback&&)` | Pops all currently queued events, invoking `callback(event)` on each. Returns the processed count. |
| `subscriber_count` | `size_t subscriber_count() const noexcept` | Number of registered subscribers. |

## Usage example

```cpp
#include "zenith/event_bus.hpp"

struct TelemetryUpdate {
    std::uint32_t vehicle_id;
    float speed_mps;
    float steering_rad;
};

zenith::EventBus<TelemetryUpdate, 1024> bus;
const auto sub = bus.subscribe();              // handle 0

// consumer thread
std::jthread consumer([&](std::stop_token stop) {
    while (!stop.stop_requested()) {
        bus.drain(sub, [](const TelemetryUpdate& m) { /* ... */ });
        std::this_thread::yield();
    }
});

// producer thread — zero allocations
bus.publish(TelemetryUpdate{42, 12.5f, -0.05f});
```

## Delivery semantics at a glance

| Call | Blocking? | Drops possible? | Use when |
|---|---|---|---|
| `publish` | No (one attempt per queue) | Yes, per-subscriber | Latency-critical producers that tolerate loss |
| `publish_wait` | Spins until accepted | No | Exactly-once fan-out, backpressure wanted |
| `poll` | No | n/a | Single-event consumer step |
| `drain` | No | n/a | Batch consumption per loop iteration |
