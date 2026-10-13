# API Reference

All of it lives in `namespace zenith`. Two headers:
`zenith/spsc_queue.hpp` and `zenith/event_bus.hpp`. That's the library.

## `TriviallyRelocatable`

```cpp
template <typename T>
concept TriviallyRelocatable =
    std::is_trivially_copyable_v<T> && std::is_standard_layout_v<T>;
```

What your payload must satisfy. Plain structs of scalars are fine;
`std::string`, `std::vector`, anything with a constructor or destructor is
not — slots are raw storage and get bitwise copies, so an owning pointer
would double-free.

One nuance: the concept checks copyability, not ownership. A struct holding a
raw `int*` still compiles — pointers aren't the problem, *owning* what they
point to is. Also note the queue stores a `std::array` and assigns into its
elements, so payloads need to be default-constructible and assignable too.

## `SPSCQueue<T, Capacity>`

`Capacity` must be a power of two and at least 2 — checked at compile time.

| member | signature | what it does |
|---|---|---|
| `try_push` | `bool try_push(const T&)` / `bool try_push(T&&)` | Enqueue. `false` = queue full, nothing happened. `noexcept`. Producer thread only. |
| `try_pop` | `bool try_pop(T& out)` | Dequeue into `out`. `false` = empty. `noexcept`. Consumer thread only. |
| `size_approx` | `std::size_t size_approx()` | Roughly how many items. The peer index can move mid-call — approximate by design. |
| `empty` | `bool empty()` | Same caveat. |

One producer thread, one consumer thread — that's the contract. Two producers
or two consumers on one queue is UB; that's what makes it lock-free.

## `EventBus<T, QueueCapacity, MaxSubscribers = 8>`

Owns `MaxSubscribers` queues, all created empty at construction.

| member | signature | what it does |
|---|---|---|
| `subscribe` | `std::size_t subscribe()` | Reserves a queue, returns its handle. Call at setup, before publishing. Throws `std::length_error` past `MaxSubscribers`. |
| `subscriber_count` | `std::size_t subscriber_count()` | How many queues are live. |
| `publish` | `bool publish(const T&)` | One `try_push` per queue. `false` = some subscriber's queue was full and that subscriber dropped the event — *while others still received it*. Do not retry the same event. |
| `publish_wait` | `void publish_wait(const T&)` | Spins (yielding) until every queue accepts. Exactly-once fan-out — but it blocks forever if a subscriber stops draining. |
| `poll` | `bool poll(std::size_t sub, T& out)` | One non-blocking pop from subscriber `sub`'s queue. |
| `drain` | `std::size_t drain(std::size_t sub, Callback&&)` | Pops everything currently queued, calls `callback(item)` for each, returns the count. This is what your consumer loop wants. |

Bad subscriber handles are handled, not fatal: `poll` returns `false`,
`drain` returns 0.

## The guarantees, in plain terms

- Hot-path functions are all `noexcept` and never allocate.
- Per-subscriber ordering is strict FIFO — every subscriber sees events in
  publish order, whenever its drain loop gets around to them.
- `subscribe()` is safe to call while publishing (CAS-guarded), but a late
  subscriber only sees events published *after* it registers.
- Exactly one producer thread total; exactly one consumer thread per queue.
