# Contributing to ZenithBus

Thanks for your interest. ZenithBus is a header-only C++20 lock-free event
bus — contributions that keep it fast, allocation-free, and correct under
concurrency are welcome.

## Prerequisites

- CMake 3.22+
- GCC 12+ or Clang 15+
- (Optional) Ninja, clang-tidy, clang-format

## Development workflow

```bash
# Configure and build with tests, examples, benchmarks
cmake -B build -G Ninja \
  -DZENITH_BUILD_TESTS=ON -DZENITH_BUILD_EXAMPLES=ON -DZENITH_BUILD_BENCHMARKS=ON
cmake --build build

# Run the test suite
ctest --test-dir build --output-on-failure
```

### Sanitizers

All changes touching `include/zenith/` must pass both sanitizers:

```bash
# AddressSanitizer + UndefinedBehaviorSanitizer
cmake -B build-asan -DZENITH_BUILD_TESTS=ON \
  -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer"
cmake --build build-asan && ctest --test-dir build-asan --output-on-failure

# ThreadSanitizer
cmake -B build-tsan -DZENITH_BUILD_TESTS=ON \
  -DCMAKE_CXX_FLAGS="-fsanitize=thread -fno-omit-frame-pointer"
cmake --build build-tsan && ctest --test-dir build-tsan --output-on-failure
```

### Benchmarks

```bash
./build/benchmarks/bench_event_bus
```

Any change to `SPSCQueue` or `EventBus` must not regress single-digit
nanosecond push/pop latency on modern x86-64 hardware.

### Formatting and static analysis

```bash
clang-format -i include/zenith/*.hpp tests/*.cpp examples/*.cpp benchmarks/*.cpp
run-clang-tidy -p build "include/.*|tests/.*"   # needs CMAKE_EXPORT_COMPILE_COMMANDS=ON
```

## Hard rules for hot-path code

- **Zero dynamic allocation** in `try_push`/`try_pop`/`publish`/`poll`/`drain`.
- Atomics use only `relaxed`, `acquire`, `release` — no `seq_cst` or
  `lock`-prefixed RMWs without a benchmark proving necessity.
- Shared indices stay `alignas(64)`-separated to prevent false sharing.
- Payload types must satisfy `zenith::TriviallyRelocatable`.

## Commits and pull requests

- Conventional Commits: `feat:`, `fix:`, `test:`, `ci:`, `docs:`, `perf:`.
- One logical change per commit; keep diffs focused.
- Fill in the PR template checklist — it exists to protect the invariants
  above. CI (compiler matrix, sanitizers, clang-format, clang-tidy) and
  CodeRabbit review must be green before merge.
