# Benchmarking and Performance

## Run them

```bash
make bench       # everything, Release build — always Release, a Debug
                 # benchmark measures nothing
```

Or the raw way:

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release -DZENITH_BUILD_BENCHMARKS=ON
cmake --build build -j
./build/benchmarks/bench_event_bus --benchmark_min_time=1s
```

`make bench-rt` runs just the concurrent benchmarks.

## What each number means

| benchmark | what you're looking at |
|---|---|
| `BM_SPSC_PushPopRoundTrip` | The raw cost of the mechanism with zero contention — ~5.4 ns on the dev machine. Best-case floor. |
| `BM_SPSC_PushThroughput` | Enqueue-only ceiling while there's capacity — ~2.8 ns/op. |
| `BM_EventBus_FanoutPublish` | Cost of one `publish_wait` to 1/2/4/8 subscribers — roughly 6→20 ns. |
| `BM_SPSC_PingPongLatency` | **The headline.** Producer and consumer on separate pinned threads, strict request→echo so exactly one item is ever in flight. This measures the actual cross-core handoff — the acquire/release visibility plus cache-line transfer. p50 ~50 ns, p99 ~150 ns on the dev box. |
| `BM_SPSC_InterThreadThroughput` | Real producer flooding, real consumer draining — ~55 M msg/s. This exercises the cached-peer-index fast path for real. |

Why ping-pong and not a plain "latency" number? Because if the producer can
race ahead and fill the queue, you're measuring *queueing delay* — how deep
the buffer is — not how fast a message crosses cores. One item in flight
removes the queue from the measurement. That's also why there's a second
`resp` queue: RTT over two handoffs is honest; half of it is the one-way
latency.

## The false-sharing experiment

`bench_event_bus_nopad` is the identical benchmark built with
`-DZENITH_NO_CACHELINE_PAD`, which strips `alignas(64)` so `head_` and
`tail_` share a cache line. On the dev machine it loses 6–30% throughput
depending on where the OS happens to put the threads — macOS can't pin, so
it floats.

On Linux, count the misses directly:

```bash
perf stat -e L1-dcache-loads,L1-dcache-load-misses,cache-misses \
  ./build-release/benchmarks/bench_event_bus --benchmark_filter=InterThread

perf stat -e L1-dcache-loads,L1-dcache-load-misses,cache-misses \
  ./build-release/benchmarks/bench_event_bus_nopad --benchmark_filter=InterThread
```

CI does this automatically in the `perf-false-sharing` job. It's marked
informational (`continue-on-error`) because hosted-runner PMU access is
flaky — when it works, it prints the L1 miss counts for both builds.

## Reading your own numbers honestly

- These numbers include clock overhead — a `steady_clock` read costs
  ~20–40 ns itself, so real handoff latency is *better* than reported.
- Laptop numbers have scheduling noise. For publishable numbers: idle
  machine, `isolcpus` + `taskset`, performance governor.
- Debug builds are meaningless for benchmarks. If your numbers look 10×
  worse, check `CMAKE_BUILD_TYPE` first.
