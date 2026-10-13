# Contributing

Thanks for wanting in. Quick heads-up: the bar for touching
`include/zenith/` is high — it has to stay lock-free, allocation-free, and
correct under concurrency. A clever optimization that's wrong 0.001% of the
time is a regression here.

## Setup

CMake 3.22+, GCC 12+ or Clang 15+. Everything else fetches itself or is
optional.

```bash
make test      # build + run the suite — this covers most of your loop
make bench     # benchmarks, incl. the real 2-thread ping-pong (Release)
make asan      # ASan + UBSan
make tsan      # ThreadSanitizer — non-negotiable if you touched atomics
make viz       # the web visualizer (python3, no node needed)
```

(The Makefile is a thin wrapper — `cat Makefile` to see the raw commands.)

## The rules

- **No allocations, no exceptions** inside `try_push` / `try_pop` /
  `publish` / `poll` / `drain`.
- Atomics are `relaxed` / `acquire` / `release` only. If you think you need
  `seq_cst` or a locked RMW, bring the benchmark that proves it.
- `head_` and `tail_` stay on separate cache lines — `ZENITH_CACHELINE`.
  Don't touch it; `bench_event_bus_nopad` exists to show what happens.
- Payloads must satisfy `TriviallyRelocatable`.
- If you change the memory ordering, write a comment explaining why it's
  still correct and make `make tsan` green. If you can't explain it, don't
  ship it.

## PRs

- Conventional Commits: `feat:` `fix:` `perf:` `test:` `docs:` `ci:`. One
  logical change per commit.
- CI has to be green: compiler matrix, sanitizers, clang-format, clang-tidy.
  CodeRabbit reviews automatically — fix its comments or say why it's wrong;
  both are fine, silence isn't.
- Touching perf? Paste before/after `make bench` output in the PR.
