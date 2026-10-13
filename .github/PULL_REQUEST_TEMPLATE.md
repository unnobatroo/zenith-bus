## Summary

<!-- What does this change do and why? -->

## Checklist

- [ ] Unit tests pass: `ctest --test-dir build --output-on-failure`
- [ ] ThreadSanitizer clean: `ctest --test-dir build-tsan` with `-fsanitize=thread`
- [ ] AddressSanitizer/UBSan clean: `ctest --test-dir build-asan` with `-fsanitize=address,undefined`
- [ ] Clang-Tidy reports no new warnings on changed files
- [ ] Clang-Format clean: `clang-format --dry-run --Werror`
- [ ] Zero heap allocations on the hot path maintained (`try_push`/`try_pop`/`publish`/`poll`/`drain`)
- [ ] Benchmarks show no latency regression (`./build/benchmarks/bench_event_bus`)

## Test plan

<!-- How was this verified? -->
