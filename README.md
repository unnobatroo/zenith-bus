# zenith-bus

Header-only C++20 lock-free event dispatcher for low-latency inter-thread
fan-out. One producer broadcasts to N subscribers; every subscriber owns a
dedicated single-producer/single-consumer ring buffer.

## Why lock-free SPSC

In real-time pipelines (telemetry, market data, robotics), a mutex on the
message path adds unpredictable contention, priority inversion, and syscall
wakeups. A bounded SPSC ring buffer has none of that: the producer writes a
slot and releases one atomic index; each consumer advances its own head
index. Producer and consumer indices sit on separate cache lines so cores
never fight over the same line, and each side caches the peer index to keep
cross-core traffic off the hot path.

## Quickstart

```cpp
#include "zenith/event_bus.hpp"

struct TelemetryUpdate {
    std::uint32_t vehicle_id;
    float speed_mps;
    float steering_rad;
};

zenith::EventBus<TelemetryUpdate, 1024> bus;   // capacity: power of two, >= 2
const auto sub = bus.subscribe();              // up to 8 subscribers

std::jthread consumer([&](std::stop_token stop) {
    while (!stop.stop_requested()) {
        bus.drain(sub, [](const TelemetryUpdate& m) {
            fmt::print("vehicle {} speed {} m/s\n", m.vehicle_id, m.speed_mps);
        });
        std::this_thread::yield();
    }
});

bus.publish(TelemetryUpdate{42, 12.5F, -0.05F});  // zero heap allocation
```

`publish()` is non-blocking and returns `false` if any subscriber queue is
full (that subscriber drops the event). `publish_wait()` spins until every
subscriber accepts — use it when no subscriber may drop a message.

Payloads must satisfy `zenith::TriviallyRelocatable` (trivially copyable,
standard layout — plain structs are fine).

## Build

Requirements: Linux x86_64, GCC 12+ or Clang 15+, CMake 3.22+.

```bash
cmake -B build -DZENITH_BUILD_TESTS=ON -DZENITH_BUILD_BENCHMARKS=ON
cmake --build build -j
ctest --test-dir build --output-on-failure
```

Example CLI:

```bash
./build/examples/vehicle_telemetry_cli --subscribers 2 --rate-hz 1000 --duration-sec 5
```

Benchmarks:

```bash
./build/benchmarks/bench_event_bus
```

The library itself is header-only: add `include/` to your include path and
compile with `-std=c++20`. Dependencies (GoogleTest, Google Benchmark, fmt,
CLI11) are fetched via CMake `FetchContent` and only needed for tests,
benchmarks, and examples.

## Sanitizers

```bash
cmake -B build -DZENITH_BUILD_TESTS=ON -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined"
cmake --build build && ctest --test-dir build --output-on-failure
# repeat with -fsanitize=thread
```

## Web visualizer (`web/`)

Interactive Vite + React app that runs the *actual* headers compiled to
WebAssembly (bindings in `wasm/zenith_api.cpp`, `EMSCRIPTEN_KEEPALIVE` C API).
Ring buffer slots, indices, and cached peer indices are read live from the
real compiled objects; the cache-line view is a simplified MESI model
(hardware state is not observable in a browser).

```bash
cd web && npm install && npm run dev        # dev server
npm run build                               # production build (dist/)
npm run build:wasm                          # rebuild wasm (needs emscripten)
```

The committed `web/src/wasm/zenith.{js,wasm}` artifacts let Vercel deploy
without Emscripten in the build image. Deploy `web/` as the project root.
