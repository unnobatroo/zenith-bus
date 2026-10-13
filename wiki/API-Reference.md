# API Reference

Everything lives in `namespace zenith`. Include `zenith/spsc_queue.hpp` or
`zenith/event_bus.hpp` — that's the whole library.

## `TriviallyRelocatable`

```cpp
template <typename T>
concept TriviallyRelocatable =
    std::is_trivially_copyable_v<T> && std::is_standard_layout_v<T>;
```

Payload constraint. Plain structs of scalars qualify; `std::string`,
`std::vector`, and anything with a constructor/destructor don't. Note the
boundary: a struct containing a raw `int*` still satisfies the concept —
pointers aren't checked — but if it *owns* what it points to, the bitwise
slot copy shares ownership and you'll double-free. Payloads must also be
assignable (the ring writes slots via copy assignment) and default-
constructible (the `std::array` storage is default-constructed).

## `SPSCQueue<T, Capacity>`

`Capacity`: power of two, `>= 2`, compile-time enforced.

| member | signature | notes |
|---|---|---|
| `try_push` | `bool try_push(const T&)` / `bool try_push(T&&)` | `false` when full. `noexcept`. Producer thread only. |
| `try_pop` | `bool try_pop(T& out)` | `false` when empty. `noexcept`. Consumer thread only. |
| `size_approx` | `std::size_t size_approx()` | Approximate — the peer index can move mid-call. |
| `empty` | `bool empty()` | Same caveat. |

One producer thread, one consumer thread. More than one of either is UB —
that's the price of lock-free.

## `EventBus<T, QueueCapacity, MaxSubscribers = 8>`

Owns `MaxSubscribers` queues, created empty at construction.

| member | signature | notes |
|---|---|---|
| `subscribe` | `std::size_t subscribe()` | Returns a queue handle `0..MaxSubscribers-1`. Call at setup before publishing. Safe to call concurrently, but hot-path subscribers should be registered up front. |
| `subscriber_count` | `std::size_t subscriber_count()` | Active subscriptions. |
| `publish` | `bool publish(const T&)` | One `try_push` per queue. `false` = at least one subscriber's queue was full → that subscriber dropped the event (partial delivery — do not retry the same event). |
| `publish_wait` | `void publish_wait(const T&)` | Spins with `yield()` until every subscriber accepts. Exactly-once fan-out. Blocks forever if a subscriber stops draining. |
| `poll` | `bool poll(std::size_t sub, T& out)` | One non-blocking pop from subscriber `sub`'s queue. |
| `drain` | `std::size_t drain(std::size_t sub, Callback&&)` | Pops everything available, calls `callback(item)` per event, returns count. The fast path for consumers. |

Invalid `sub` handles are rejected safely (`poll`→false, `drain`→0).

## Guarantees

- All hot-path functions are `noexcept` and allocation-free.
- Ordering: FIFO per subscriber. Each subscriber sees events in publish
  order; subscribers see them at whatever time their drain loop runs.
- Threading: `subscribe` may race `publish` safely (CAS-guarded); publish
  assumes a single producer thread; each `poll`/`drain` handle has a single
  consumer thread.
