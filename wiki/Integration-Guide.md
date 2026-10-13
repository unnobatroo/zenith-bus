# Integration Guide

ZenithBus is header-only: the whole library is `include/zenith/`. There is
nothing to compile or link beyond telling your build system where the
headers live.

## CMake FetchContent (recommended)

```cmake
include(FetchContent)
FetchContent_Declare(
    zenith_bus
    GIT_REPOSITORY https://github.com/unnobatroo/zenith-bus.git
    GIT_TAG main        # pin a tag or commit for reproducible builds
)
FetchContent_MakeAvailable(zenith_bus)

target_link_libraries(your_target PRIVATE zenith::zenith)
```

`zenith::zenith` is an INTERFACE target carrying the include path and the
`cxx_std_20` requirement. Tests, examples, and benchmarks are off by
default when consumed this way (`ZENITH_BUILD_TESTS` etc. default ON only
for top-level builds of this repo itself).

## Without CMake

```bash
c++ -std=c++20 -I/path/to/zenith-bus/include your_file.cpp
```

## Minimal example

```cpp
#include "zenith/event_bus.hpp"
#include <thread>

struct TelemetryUpdate {
    std::uint32_t vehicle_id;
    float speed_mps;
    float steering_rad;
};

int main() {
    zenith::EventBus<TelemetryUpdate, 1024> bus;   // power-of-two capacity
    const auto sub = bus.subscribe();            // during setup, before publishing

    std::jthread consumer([&](std::stop_token stop) {
        while (!stop.stop_requested()) {
            bus.drain(sub, [](const TelemetryUpdate& m) { /* consume */ });
            std::this_thread::yield();
        }
    });

    bus.publish(TelemetryUpdate{42, 12.5f, -0.05f});
}
```

## Contract checklist

- Payloads must satisfy `TriviallyRelocatable` — trivially copyable and
  standard layout. Plain structs are fine.
- `subscribe()` before `publish()` begins; it is not safe to subscribe
  concurrently with an in-flight publish.
- `publish()` is non-blocking and may drop for a full subscriber; use
  `publish_wait()` when every subscriber must receive every event.
- Each subscriber handle is single-consumer — don't `poll`/`drain` the same
  `sub_id` from two threads.
- `EventBus` and `SPSCQueue` are non-copyable and non-movable — construct
  them where they will live.

## Toolchain requirements

| Requirement | Version |
|---|---|
| C++ standard | C++20 |
| GCC | 12+ |
| Clang | 15+ |
| CMake (if using FetchContent) | 3.22+ |

Validated in CI on GCC 14 and Clang 18, Release and Debug, plus
ASan/UBSan/TSan on every commit.

## License

GPL-3.0-or-later — see `LICENSE`. If GPL doesn't fit your project, that's a
deliberate upstream choice, not an oversight.
