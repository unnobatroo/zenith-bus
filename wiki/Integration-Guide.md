# Integration Guide

It's three headers. Any of these work.

## CMake FetchContent

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

## Vendored

Copy `include/zenith/` into your project, add it to the include path, compile
with `-std=c++20`. Done. No libraries to link, no build system changes, no
generated anything.

## Smallest working example

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

## The rules that will bite you

- **One producer thread, total.** Calling `publish`/`try_push` from two
  threads is UB, not a slowdown.
- **One consumer per queue.** Don't hand a subscriber handle to two threads.
- **Subscribe first, publish second.** A subscriber that registers mid-stream
  only sees events published after it.
- **`publish()` can partially fail.** Full queues drop while the rest
  accept — retrying double-delivers. For must-deliver, use `publish_wait()`
  and accept that a dead subscriber blocks it.
- **Payloads are PODs.** Trivially copyable, standard layout,
  assignable, default-constructible. No `std::string`, no owning pointers.
  Details in the [[API Reference]].

## Requirements

| | version |
|---|---|
| C++ | C++20 |
| GCC | 12+ |
| Clang | 15+ |
| CMake (only if you use it) | 3.22+ |
| Arch | anything — verified on x86-64 and ARM64 |
