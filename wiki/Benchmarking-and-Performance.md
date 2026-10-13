# Benchmarking and Performance

## Building and running benchmarks

Benchmarks use [Google Benchmark](https://github.com/google/benchmark)
(fetched automatically):

```bash
cmake -B build -DZENITH_BUILD_BENCHMARKS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/benchmarks/bench_event_bus
```

What is measured (`benchmarks/bench_event_bus.cpp`, 32-byte payload):

| Benchmark | Measures |
|---|---|
| `BM_SPSC_PushPopRoundTrip` | Uncontended single-threaded `try_push`+`try_pop` pair — round-trip latency |
| `BM_SPSC_PushThroughput` | Sustained enqueue rate (drains one slot when full) |
| `BM_EventBus_FanoutPublish/N` | `publish_wait` broadcast to N ∈ {1,2,4,8} subscribers + per-subscriber poll |

## Baseline numbers

Apple M-series (arm64), Apple Clang 21, Release:

```text
BM_SPSC_PushPopRoundTrip          5.53 ns    181 M items/s
BM_SPSC_PushThroughput            2.92 ns    351 M items/s
BM_EventBus_FanoutPublish/1       5.54 ns    181 M items/s
BM_EventBus_FanoutPublish/2       6.43 ns    311 M items/s
BM_EventBus_FanoutPublish/4       9.77 ns    410 M items/s
BM_EventBus_FanoutPublish/8      17.5  ns    457 M items/s
```

Single-digit nanosecond push/pop is the design target on modern x86-64;
fan-out scales roughly linearly in subscriber count since each `try_push`
is independent. Re-run on your hardware — absolute numbers vary with CPU
and memory clock, but the *shape* should not: no superlinear blowup, and
throughput increases with subscribers because `items_processed` counts
deliveries.

## Profiling with perf

Cache misses and branch prediction are where ring buffers live or die:

```bash
perf stat -e L1-dcache-load-misses,L1-dcache-loads,branches,branch-misses \
    ./build/benchmarks/bench_event_bus
```

What good looks like:

- **L1 miss ratio < ~1%** on the queue hot path. `alignas(64)` separation of
  `head_`/`tail_` is what keeps this near zero — the indices never share a
  line, so writes don't invalidate the peer's cached copy.
- **Branch misses < ~1%**. The full/empty checks are highly predictable;
  the rare path is the `cached_*_` reload, taken only at the boundaries.
- **No `lock`-prefixed instructions**: `objdump -d` on the benchmark binary
  shows plain `mov` for all atomic ops on x86-64 (see the
  [architecture page](Architecture-and-Memory-Model) for why).

For contention analysis under real concurrency, run the stress test under
`perf stat` too — the 10M-message `EventBus` test is a good load generator:

```bash
cmake -B build -DZENITH_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build
perf stat -e L1-dcache-load-misses,context-switches,cycles,instructions \
    ./build/tests/test_event_bus --gtest_filter='*Stress*'
```

## Regression rules of thumb

- Push/pop round-trip regression > 20% → investigate before merging.
- Any `new`/`malloc` appearing in a `try_push`/`try_pop`/`publish`/`poll`/
  `drain` path is a defect — the hot path must stay allocation-free.
- Subscriber add/remove during publishing is intentionally unsupported;
  `subscribe()` is a setup-time call.
