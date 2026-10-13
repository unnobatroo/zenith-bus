# Integration Guide

The library is three headers. Pick whichever mechanism you prefer.

## CMake FetchContent

```cmake
include(FetchContent)
FetchContent_Declare(
  zenith_bus
  GIT_REPOSITORY https://github.com/unnobatroo/zenith-bus.git
  GIT_TAG main        # pin a tag/commit for reproducibility
)
FetchContent_MakeAvailable(zenith_bus)
target_link_libraries(your_target PRIVATE zenith::zenith)
```

## Vendored

Copy `include/zenith/` into your project and add it to your include path.
Compile with `-std=c++20`. Nothing else is required — no libraries, no
linker flags, no build files.

## Minimal example

```cpp
#include "zenith/event_bus.hpp"
#include <cstdio>

struct Msg { int id; float value; };

int main() {
    zenith::EventBus<Msg, 256> bus;
    auto sub = bus.subscribe();

    bus.publish({1, 3.14f});

    Msg m{};
    while (bus.poll(sub, m))
        std::printf("got %d = %f\n", m.id, m.value);
}
```

## Rules that will bite you if ignored

- **One producer thread total.** `publish`/`try_push` from two threads = UB.
- **One consumer per queue.** Don't share a subscriber handle across threads.
- **Subscribe before publishing.** `subscribe()` during active publication
  is safe, but the new subscriber misses in-flight events.
- **`publish()` can partially fail.** Full queues drop the event while others
  accept it — a retry duplicates to the fast queues. Use `publish_wait()` for
  must-deliver events.
- **Payloads are PODs.** See `TriviallyRelocatable` in the API reference.

## Requirement matrix

| | version |
|---|---|
| C++ | C++20 |
| GCC | 12+ |
| Clang | 15+ |
| CMake (if used) | 3.22+ |
| Arch | any; verified x86-64 and ARM64 |
