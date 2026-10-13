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
#include <chrono>
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

// ---- Real-time mode ----------------------------------------------------------
// With -pthread + SharedArrayBuffer these are REAL worker threads racing on
// the real queue/bus. The JS main thread never touches the hot path — it only
// reads these atomics plus the live head_/tail_ probes. hz <= 0 = flat out.

std::atomic<bool> g_rt_on{false};
std::atomic<std::uint64_t> g_pushed{0}, g_popped{0};
std::atomic<std::uint64_t> g_push_fail{0}, g_pop_fail{0};
std::thread g_prod, g_cons;

std::atomic<std::uint64_t> g_b_published{0}, g_b_pub_fail{0};
std::atomic<std::uint64_t> g_b_drained[kBusMaxSubs]{};
std::thread g_b_prod, g_b_drain[kBusMaxSubs];

void pace(double hz) {
    static thread_local auto next = std::chrono::steady_clock::now();
    next += std::chrono::nanoseconds(static_cast<long long>(1e9 / hz));
    const auto now = std::chrono::steady_clock::now();
    if (next < now) { // fell behind — skip the burst, don't try to catch up
        next = now;
        return;
    }
    while (std::chrono::steady_clock::now() < next)
        std::this_thread::yield();
}

void produce_loop(double hz) {
    std::uint32_t v = 0;
    while (g_rt_on.load(std::memory_order_relaxed)) {
        const bool ok = withQueue([&](auto &q) { return q.try_push(v); });
        v += ok; // failed pushes keep the value → slots stay contiguous
        (ok ? g_pushed : g_push_fail).fetch_add(1, std::memory_order_relaxed);
        if (hz > 0)
            pace(hz);
    }
}

void consume_loop(double hz) {
    while (g_rt_on.load(std::memory_order_relaxed)) {
        std::uint32_t v = 0;
        const bool ok = withQueue([&](auto &q) { return q.try_pop(v); });
        (ok ? g_popped : g_pop_fail).fetch_add(1, std::memory_order_relaxed);
        if (hz > 0)
            pace(hz);
    }
}

void bus_produce_loop(double hz) {
    std::uint64_t seq = 0;
    while (g_rt_on.load(std::memory_order_relaxed)) {
        const VizPacket p{++seq, static_cast<double>(seq), 20.f + static_cast<float>(seq % 40),
                          0.4f * ((seq % 200) < 100 ? 1.f : -1.f), 0.05f};
        (g_bus.publish(p) ? g_b_published : g_b_pub_fail).fetch_add(1, std::memory_order_relaxed);
        if (hz > 0)
            pace(hz);
    }
}

void bus_drain_loop(std::size_t sub, double hz) {
    while (g_rt_on.load(std::memory_order_relaxed)) {
        const std::size_t n = g_bus.drain(sub, [&](const VizPacket &p) { g_last_popped[sub] = p; });
        g_b_drained[sub].fetch_add(n, std::memory_order_relaxed);
        if (n == 0)
            std::this_thread::yield();
        if (hz > 0)
            pace(hz);
    }
}

void join(std::thread &t) {
    if (t.joinable())
        t.join();
}

} // namespace

extern "C" {

// ---- SPSC queue API --------------------------------------------------------

EMSCRIPTEN_KEEPALIVE void zq_set_capacity(int capacity) {
    if (g_rt_on.load(std::memory_order_relaxed))
        return; // never swap the variant under running threads
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
    if (g_rt_on.load(std::memory_order_relaxed))
        return;
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
    if (g_rt_on.load(std::memory_order_relaxed))
        return;
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

// ---- Real-time threaded API --------------------------------------------------
// Real std::threads (Web Workers via -pthread) running the real hot loops.
// Start/stop from JS; observe via the same probes — values move on their own.

EMSCRIPTEN_KEEPALIVE void zq_rt_start(double push_hz, double pop_hz) {
    if (g_rt_on.exchange(true, std::memory_order_acq_rel))
        return;
    g_pushed = g_popped = g_push_fail = g_pop_fail = 0;
    g_prod = std::thread(produce_loop, push_hz);
    g_cons = std::thread(consume_loop, pop_hz);
}

EMSCRIPTEN_KEEPALIVE void zb_rt_start(double pub_hz, double hz0, double hz1, double hz2) {
    if (g_rt_on.exchange(true, std::memory_order_acq_rel))
        return;
    g_b_published = g_b_pub_fail = 0;
    for (auto &c : g_b_drained)
        c = 0;
    g_b_prod = std::thread(bus_produce_loop, pub_hz);
    const double rates[3] = {hz0, hz1, hz2};
    const std::size_t n = std::min<std::size_t>(3, g_bus.subscriber_count());
    for (std::size_t i = 0; i < n; ++i)
        g_b_drain[i] = std::thread(bus_drain_loop, i, rates[i]);
}

EMSCRIPTEN_KEEPALIVE void rt_stop() {
    if (!g_rt_on.exchange(false, std::memory_order_acq_rel))
        return;
    join(g_prod);
    join(g_cons);
    join(g_b_prod);
    for (auto &t : g_b_drain)
        join(t);
}

EMSCRIPTEN_KEEPALIVE int rt_running() { return g_rt_on.load(std::memory_order_relaxed) ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE double rt_pushed() {
    return static_cast<double>(g_pushed.load(std::memory_order_relaxed));
}
EMSCRIPTEN_KEEPALIVE double rt_popped() {
    return static_cast<double>(g_popped.load(std::memory_order_relaxed));
}
EMSCRIPTEN_KEEPALIVE double rt_push_fail() {
    return static_cast<double>(g_push_fail.load(std::memory_order_relaxed));
}
EMSCRIPTEN_KEEPALIVE double rt_pop_fail() {
    return static_cast<double>(g_pop_fail.load(std::memory_order_relaxed));
}
EMSCRIPTEN_KEEPALIVE double rt_published() {
    return static_cast<double>(g_b_published.load(std::memory_order_relaxed));
}
EMSCRIPTEN_KEEPALIVE double rt_pub_fail() {
    return static_cast<double>(g_b_pub_fail.load(std::memory_order_relaxed));
}
EMSCRIPTEN_KEEPALIVE double rt_drained(int sub) {
    return (sub >= 0 && sub < static_cast<int>(kBusMaxSubs))
               ? static_cast<double>(g_b_drained[sub].load(std::memory_order_relaxed))
               : 0;
}
}
