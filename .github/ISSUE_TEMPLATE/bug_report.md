---
name: Bug report
about: Report a correctness, crash, or performance problem
title: "bug: "
labels: bug
---

## Environment

- OS / platform: <!-- e.g. Ubuntu 24.04 x86-64 -->
- Compiler & version: <!-- e.g. GCC 14.2, Clang 18.1 -->
- CMake version:
- ZenithBus commit/tag:

## What happened

<!-- Expected vs actual behavior -->

## Sanitizer output

<!-- If reproducible under ASan/TSan/UBSan, paste the report -->
<!--
cmake -B build-tsan -DZENITH_BUILD_TESTS=ON -DCMAKE_CXX_FLAGS="-fsanitize=thread"
cmake --build build-tsan && ctest --test-dir build-tsan --output-on-failure
-->

## Minimal reproduction

```cpp
// smallest snippet that reproduces the issue
```

## Additional context

<!-- workload details: queue capacity, subscriber count, push/pop rates -->
