# ZenithBus

Header-only C++20 lock-free event dispatcher for low-latency inter-thread
fan-out. One producer broadcasts events to up to `MaxSubscribers` dedicated
single-producer/single-consumer ring buffers — no locks, no dynamic
allocation on the dispatch path, single-digit nanosecond push/pop on modern
x86-64.

```text
                 ┌──────────────────────┐
                 │   Producer thread    │
                 │   bus.publish(msg)   │
                 └──────────┬───────────┘
                            │ broadcast (one try_push per queue)
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
 ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
 │ SPSCQueue 0 │    │ SPSCQueue 1 │    │ SPSCQueue N │   (max 8 by default)
 │ Safety Mon. │    │ Disk Logger │    │ UI Renderer │
 └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
        ▼                  ▼                  ▼
   consumer t0        consumer t1        consumer tN
   drain(sub_id)      drain(sub_id)      drain(sub_id)
```

Each subscriber owns an independent ring buffer. Subscribers never block
each other: a slow consumer only fills its own queue — `publish()` reports
the drop, and `publish_wait()` back-pressures until every subscriber accepts.

## Design decisions

- **Zero dynamic allocation on the hot path.** All `N` queues are
  pre-allocated in a fixed `std::array` at `EventBus` construction.
  `publish`, `poll`, and `drain` never call `new`/`malloc`.
- **Compile-time capacity validation.** `static_assert` enforces
  power-of-two capacity ≥ 2 so index wrap is a single `&` mask.
- **Acquire/release only.** Producer publishes with a release store on
  `tail_`; the consumer reads it with an acquire load. On x86-64 both
  compile to plain `mov` — verified in `benchmarks/` and in the wiki
  [architecture page](Architecture-and-Memory-Model).
- **Trivially relocatable payloads.** `TriviallyRelocatable` concept
  constrains payloads to trivially-copyable, standard-layout types; slots
  are raw storage, no per-element constructors.
- **Sub-microsecond latency.** Measured ~5.5 ns push+pop round-trip and
  ~350 M messages/s sustained on Apple Silicon; see
  [Benchmarking and Performance](Benchmarking-and-Performance).

## In this wiki

| Page | Contents |
|---|---|
| [Architecture and Memory Model](Architecture-and-Memory-Model) | SPSC mechanics, false sharing, acquire-release proof, cached peer indices |
| [API Reference](API-Reference) | `SPSCQueue`, `EventBus`, `TriviallyRelocatable` signatures and semantics |
| [Benchmarking and Performance](Benchmarking-and-Performance) | Running benchmarks, baselines, `perf stat` profiling |
| [Integration Guide](Integration-Guide) | CMake `FetchContent`, linking, minimal example |

## Requirements

Linux x86-64, GCC 12+ or Clang 15+, CMake 3.22+. The library is header-only;
dependencies (GoogleTest, Google Benchmark, fmt, CLI11) are fetched by CMake
and only needed for tests, benchmarks, and examples.
