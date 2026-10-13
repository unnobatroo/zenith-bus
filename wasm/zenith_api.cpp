// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

// WASM binding layer for the ZenithBus visualizer. Exposes the real
// zenith::SPSCQueue and zenith::EventBus to JavaScript via a flat C API.
//
// The `#define private public` trick below is binding-only: it lets the
// visualizer read internal indices (head_, tail_, cached_head_,
// cached_tail_, storage_) so the UI can show genuinely real queue state.
// It changes nothing semantically and the library itself is untouched.
//
// System headers are pre-included first so their include guards already
// fired before `private` is redefined (standard practice for this trick).

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <thread>
#include <type_traits>
#include <utility>
#include <variant>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#define private public
#include "zenith/event_bus.hpp"
#include "zenith/spsc_queue.hpp"
#undef private

namespace {

// ---- SPSC playground queue -------------------------------------------------

using Q8 = zenith::SPSCQueue<std::uint32_t, 8>;
using Q16 = zenith::SPSCQueue<std::uint32_t, 16>;
using Q32 = zenith::SPSCQueue<std::uint32_t, 32>;

// variant + emplace: the queues are non-movable (they hold atomics).
std::variant<Q8, Q16, Q32> g_queue{std::in_place_type<Q8>};
int g_capacity = 8;

template <typename F> auto withQueue(F &&f) {
    return std::visit([&](auto &q) { return f(q); }, g_queue);
}

// ---- Event bus -------------------------------------------------------------

struct VizPacket {
    std::uint64_t seq;
    double timestamp_ms;
    float speed_mps;
    float steering_rad;
    float yaw_rate_rad;
};

constexpr std::size_t kBusCapacity = 16;
constexpr std::size_t kBusMaxSubs = 4;

zenith::EventBus<VizPacket, kBusCapacity, kBusMaxSubs> g_bus;
VizPacket g_last_popped[kBusMaxSubs]{};
double g_drain_ts[kBusCapacity];
std::size_t g_drain_count = 0;

} // namespace

extern "C" {

// ---- SPSC queue API --------------------------------------------------------

EMSCRIPTEN_KEEPALIVE void zq_set_capacity(int capacity) {
    g_capacity = capacity;
    switch (capacity) {
    case 8:
        g_queue.emplace<Q8>();
        break;
    case 16:
        g_queue.emplace<Q16>();
        break;
    default:
        g_queue.emplace<Q32>();
        break;
    }
}

EMSCRIPTEN_KEEPALIVE void zq_reset() {
    withQueue([](auto &q) { g_queue.emplace<std::decay_t<decltype(q)>>(); });
}

EMSCRIPTEN_KEEPALIVE int zq_push(std::uint32_t value) {
    return withQueue([&](auto &q) { return q.try_push(value) ? 1 : 0; });
}

EMSCRIPTEN_KEEPALIVE int zq_pop() {
    return withQueue([](auto &q) {
        std::uint32_t v = 0;
        return q.try_pop(v) ? static_cast<int>(v) : -1;
    });
}

// Internal index probes — real atomic/cached values from the live object.
EMSCRIPTEN_KEEPALIVE double zq_head() {
    return withQueue(
        [](auto &q) { return static_cast<double>(q.head_.load(std::memory_order_relaxed)); });
}
EMSCRIPTEN_KEEPALIVE double zq_tail() {
    return withQueue(
        [](auto &q) { return static_cast<double>(q.tail_.load(std::memory_order_relaxed)); });
}
EMSCRIPTEN_KEEPALIVE double zq_cached_head() {
    return withQueue([](auto &q) { return static_cast<double>(q.cached_head_); });
}
EMSCRIPTEN_KEEPALIVE double zq_cached_tail() {
    return withQueue([](auto &q) { return static_cast<double>(q.cached_tail_); });
}
EMSCRIPTEN_KEEPALIVE double zq_size() {
    return withQueue([](auto &q) { return static_cast<double>(q.size_approx()); });
}
EMSCRIPTEN_KEEPALIVE int zq_capacity() { return g_capacity; }

// Raw slot read — returns whatever bytes occupy storage_[i] (stale data for
// free slots, exactly like the real ring).
EMSCRIPTEN_KEEPALIVE std::uint32_t zq_slot_value(int i) {
    return withQueue([&](auto &q) { return q.storage_[static_cast<std::size_t>(i)]; });
}

// ---- Event bus API ---------------------------------------------------------

EMSCRIPTEN_KEEPALIVE void zb_reset() {
    g_bus.~EventBus();
    new (&g_bus) zenith::EventBus<VizPacket, kBusCapacity, kBusMaxSubs>();
    g_drain_count = 0;
}

EMSCRIPTEN_KEEPALIVE int zb_subscribe() {
    try {
        return static_cast<int>(g_bus.subscribe());
    } catch (...) {
        return -1;
    }
}

static bool valid_sub(int sub) {
    return sub >= 0 && static_cast<std::size_t>(sub) < g_bus.subscriber_count();
}

// Returns bit0 = publish() result; bits 1..N = queues that were already at
// capacity BEFORE the push attempt (i.e. exactly the ones that dropped this
// packet — try_push fails iff full). Assumes single-threaded callers, which
// holds for the JS/WASM boundary: no consumer can drain mid-publish.
EMSCRIPTEN_KEEPALIVE int zb_publish(double seq, double ts, float speed, float steer, float yaw) {
    const VizPacket p{static_cast<std::uint64_t>(seq), ts, speed, steer, yaw};
    int full_mask = 0;
    for (std::size_t i = 0; i < g_bus.subscriber_count(); ++i) {
        if (g_bus.queues_[i].size_approx() >= kBusCapacity)
            full_mask |= 1 << (i + 1);
    }
    const bool ok = g_bus.publish(p);
    return (ok ? 1 : 0) | full_mask;
}

EMSCRIPTEN_KEEPALIVE int zb_drain(int sub) {
    g_drain_count = 0; // clear first so invalid subs can't leak stale results
    if (!valid_sub(sub))
        return 0;
    const std::size_t n = g_bus.drain(static_cast<std::size_t>(sub), [&](const VizPacket &p) {
        g_last_popped[sub] = p;
        if (g_drain_count < kBusCapacity) {
            g_drain_ts[g_drain_count] = p.timestamp_ms;
        }
        ++g_drain_count;
    });
    return static_cast<int>(n);
}

EMSCRIPTEN_KEEPALIVE double zb_drain_ts(int i) {
    return i >= 0 && static_cast<std::size_t>(i) < kBusCapacity ? g_drain_ts[i] : -1.0;
}

EMSCRIPTEN_KEEPALIVE double zb_last_field(int sub, int field) {
    if (!valid_sub(sub))
        return 0;
    const VizPacket &p = g_last_popped[sub];
    switch (field) {
    case 0:
        return static_cast<double>(p.seq);
    case 1:
        return p.timestamp_ms;
    case 2:
        return p.speed_mps;
    case 3:
        return p.steering_rad;
    case 4:
        return p.yaw_rate_rad;
    default:
        return 0;
    }
}

EMSCRIPTEN_KEEPALIVE int zb_occupancy(int sub) {
    if (!valid_sub(sub))
        return 0;
    return static_cast<int>(g_bus.queues_[static_cast<std::size_t>(sub)].size_approx());
}
EMSCRIPTEN_KEEPALIVE int zb_subscriber_count() {
    return static_cast<int>(g_bus.subscriber_count());
}
}
