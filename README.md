# ZenithBus

A tiny header-only C++20 library that moves events between threads without
locks. One producer broadcasts to N subscribers; each subscriber gets its own
single-producer/single-consumer ring buffer. No heap allocation, no mutexes,
no CAS loops on the hot path.

```
publisher thread ──publish()──► ┌─ queue 0 ──► consumer thread 0
                                ├─ queue 1 ──► consumer thread 1
                                └─ queue 2 ──► consumer thread 2
```

## Try it in 30 seconds

```bash
make test    # build + run the whole suite (incl. a 10M-message stress test)
make bench   # latency & throughput numbers, incl. real 2-thread ping-pong
make viz     # serve the interactive WASM visualizer at localhost:8469
```

Requires: CMake 3.22+, GCC 12+ or Clang 15+. Test deps are fetched
automatically — the library itself needs nothing but `<atomic>`.

## Using it

```cpp
#include "zenith/event_bus.hpp"
#include <fmt/core.h>

struct Telemetry { uint32_t id; float speed; float steer; };

zenith::EventBus<Telemetry, 1024> bus;      // capacity: power of two, ≥ 2
auto sub = bus.subscribe();                 // call once at setup, ≤ 8 subs

std::jthread reader([&](std::stop_token st) {
    while (!st.stop_requested())
        bus.drain(sub, [](const Telemetry& t) {
            fmt::print("vehicle {} at {} m/s\n", t.id, t.speed);
        });
});

bus.publish({42, 12.5f, -0.05f});           // non-blocking, no allocation
```

Two things to know:

- `publish()` returns `false` if any subscriber's queue is full — that
  subscriber drops the event. Use `publish_wait()` when drops aren't allowed
  (spins until everyone accepts; a dead subscriber will block it forever).
- Payloads must be trivially copyable plain structs
  (`zenith::TriviallyRelocatable`) — slots are raw storage, nothing is
  constructed or destroyed per message.

## How it stays fast

The SPSC queue is the classic design (folly, moodycamel): producer and
consumer each own one index on its own 64-byte cache line, so the cores never
fight over the same line. Each side keeps a cached copy of the peer's index
and only does the real atomic load when the queue *looks* full/empty. Payload
writes are ordered by a release store on the index; the consumer pairs it
with an acquire load. On x86-64 all of this is plain `mov` — no `lock`, no
fences.

Measured on this machine (Apple M-series, loaded desktop):

| benchmark | result |
|---|---|
| same-thread push+pop | ~5.5 ns/op |
| 2-thread ping-pong RTT | ~50 ns p50, ~150 ns p99 |
| 2-thread sustained throughput | ~55 M msg/s |
| fan-out publish to 8 subs | ~17.5 ns/publish |
| same, without `alignas(64)` | −6–30% throughput (noisy unpinned runs — false sharing is real) |

Run `make bench` for your own numbers. CI additionally runs `perf stat` on
padded vs unpadded builds to count the L1 misses directly.

## The visualizer

`web/` is a zero-dependency static site (no npm, no build step — plain HTML,
CSS, and ES modules). It loads the *actual* `spsc_queue.hpp`/`event_bus.hpp`
compiled to WebAssembly with real worker threads (`wasm/zenith_api.cpp`
exposes a small C API). The ring view's pointers and the bus view's queues
are live state from running threads, not an animation. The cache-line view is
a conceptual MESI diagram — browser code can't observe coherence state, and
it says so on the tin.

`make viz` serves it locally with the COOP/COEP headers SharedArrayBuffer
requires; `vercel.json` sets the same headers for deployment.

## More

- [Full API reference](wiki/API-Reference.md) ·
  [memory-model deep dive](wiki/Architecture-and-Memory-Model.md) ·
  [integration guide](wiki/Integration-Guide.md)
- `examples/vehicle_telemetry_cli.cpp` — realistic CLI demo (CLI11 + fmt)
- `CONTRIBUTING.md` — dev workflow, sanitizer builds, PR checklist
