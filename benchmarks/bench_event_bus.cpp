// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

#include <benchmark/benchmark.h>

#include "zenith/event_bus.hpp"
#include "zenith/spsc_queue.hpp"

#include <cstdint>

namespace {

struct Payload32 {
    std::uint64_t a;
    std::uint64_t b;
    std::uint64_t c;
    std::uint64_t d;
};
static_assert(sizeof(Payload32) == 32);

// Uncontended single-threaded push+pop round-trip latency.
void BM_SPSC_PushPopRoundTrip(benchmark::State &state) {
    zenith::SPSCQueue<Payload32, 1024> queue;
    Payload32 in{1, 2, 3, 4};
    Payload32 out{};
    for (auto _ : state) {
        queue.try_push(in);
        queue.try_pop(out);
        benchmark::DoNotOptimize(out);
    }
    state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_SPSC_PushPopRoundTrip);

// Sustained enqueue-only throughput while the queue has capacity.
void BM_SPSC_PushThroughput(benchmark::State &state) {
    zenith::SPSCQueue<Payload32, 4096> queue;
    Payload32 in{1, 2, 3, 4};
    Payload32 out{};
    for (auto _ : state) {
        if (!queue.try_push(in)) {
            // Queue full: drain one slot instead of spinning.
            queue.try_pop(out);
            benchmark::DoNotOptimize(out);
        }
    }
    state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_SPSC_PushThroughput);

// Fan-out publish cost to N subscribers (queues pre-drained each iteration
// so the measured path is the broadcast itself).
void BM_EventBus_FanoutPublish(benchmark::State &state) {
    constexpr std::size_t kMaxSubs = 8;
    zenith::EventBus<Payload32, 1024, kMaxSubs> bus;
    const auto n_subs = static_cast<std::size_t>(state.range(0));
    std::vector<std::size_t> subs;
    for (std::size_t i = 0; i < n_subs; ++i) {
        subs.push_back(bus.subscribe());
    }

    Payload32 in{1, 2, 3, 4};
    Payload32 out{};
    for (auto _ : state) {
        bus.publish_wait(in);
        benchmark::ClobberMemory();
        for (auto s : subs) {
            bus.poll(s, out);
        }
        benchmark::DoNotOptimize(out);
    }
    state.SetItemsProcessed(state.iterations() * static_cast<std::int64_t>(n_subs));
}
BENCHMARK(BM_EventBus_FanoutPublish)->Arg(1)->Arg(2)->Arg(4)->Arg(8);

} // namespace

BENCHMARK_MAIN();
