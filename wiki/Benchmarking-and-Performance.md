# Benchmarking and Performance

## Run it

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release -DZENITH_BUILD_BENCHMARKS=ON
cmake --build build -j
./build/benchmarks/bench_event_bus --benchmark_min_time=1s
```

Or just `make bench` / `make bench-rt` (concurrent benchmarks only).

## What gets measured

| benchmark | what it tells you |
|---|---|
| `BM_SPSC_PushPopRoundTrip` | Raw cost of the mechanism with zero contention (~5.5 ns on M-series). |
| `BM_SPSC_PushThroughput` | Enqueue-only ceiling while capacity lasts. |
| `BM_EventBus_FanoutPublish` | Per-publish cost at 1/2/4/8 subscribers (~5.5→17.5 ns). |
| `BM_SPSC_PingPongLatency` | **The real claim.** Two threads, one item in flight, strict request→echo round trip. On the dev machine: p50 ~50 ns, p99 ~200 ns. This measures the actual cross-core handoff — acquire/release visibility plus cache-line transfer. |
| `BM_SPSC_InterThreadThroughput` | Producer and consumer on separate threads, flooding — ~53 M msg/s. |

Both threaded benchmarks pin thread 0→CPU 0, thread 1→CPU 1 on Linux.

## The false-sharing experiment

`bench_event_bus_nopad` is the same binary built with
`-DZENITH_NO_CACHELINE_PAD`, which removes `alignas(64)` so `head_` and
`tail_` share a cache line. On the dev machine the loss runs ~6–30%
depending on core placement (macOS can't pin threads — numbers float).

Count the misses directly on Linux:

```bash
perf stat -e L1-dcache-loads,L1-dcache-load-misses,cache-misses \
  ./build/benchmarks/bench_event_bus --benchmark_filter=InterThread

perf stat -e L1-dcache-loads,L1-dcache-load-misses,cache-misses \
  ./build/benchmarks/bench_event_bus_nopad --benchmark_filter=InterThread
```

CI does this automatically in the `perf-false-sharing` job (informational —
hosted-runner PMU access is flaky, so it never gates).

## Reading the numbers honestly

- Desktop numbers include clock overhead (~20–40 ns per `steady_clock` pair)
  and OS scheduling noise. Reported latencies are conservative.
- A queue-deep producer measures queueing delay, not handoff latency — that's
  why ping-pong uses a reply queue to keep exactly one item in flight.
- For publishable numbers, run on idle hardware with CPU isolation
  (`isolcpus`, `taskset`) and governor pinned to performance.
