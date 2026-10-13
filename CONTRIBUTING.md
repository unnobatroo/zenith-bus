# Contributing

Thanks! The bar for changes to `include/zenith/` is high: it must stay
lock-free, allocation-free, and correct under concurrency.

## Setup

You need CMake 3.22+ and GCC 12+ or Clang 15+. Everything else is fetched by
CMake or optional.

```bash
make test    # build + run the suite — covers most of the loop below
make bench   # benchmarks, including the real 2-thread ping-pong
make asan    # ASan + UBSan build and test
make tsan    # ThreadSanitizer build and test — required for atomic changes
```

(Plain `cmake`/`ctest` equivalents are in the Makefile if you prefer.)

## The rules

- **No allocation, no exceptions** on `try_push`/`try_pop`/`publish`/`poll`/`drain`.
- Atomics are `relaxed`/`acquire`/`release` only. Want `seq_cst` or a `lock`-
  prefixed op? Bring a benchmark showing why.
- `head_` and `tail_` stay on separate cache lines (`ZENITH_CACHELINE`).
- Payloads must satisfy `TriviallyRelocatable`.
- Touch the memory ordering? Write a comment explaining *why* it's still
  correct, and make sure `make tsan` passes.

## PRs

- Conventional Commits (`feat:` `fix:` `perf:` `test:` `docs:` `ci:`), one
  logical change per commit.
- CI matrix + sanitizers + clang-format/clang-tidy must pass. CodeRabbit
  reviews automatically — address or rebut its comments.
- Performance-sensitive changes: include before/after `make bench` output.
