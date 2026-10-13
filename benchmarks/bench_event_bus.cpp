// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

#include <benchmark/benchmark.h>

#include "zenith/event_bus.hpp"
#include "zenith/spsc_queue.hpp"

#include <array>
#include <chrono>
#include <cstdint>
#include <thread>

#if defined(__linux__)
#include <pthread.h>
#include <sched.h>
#endif

namespace {

struct Payload32 {
    std::uint64_t a;
    std::uint64_t b;
    std::uint64_t c;
    std::uint64_t d;
};
static_assert(sizeof(Payload32) == 32);

// Timestamped payload for inter-thread latency: the producer stamps `t0`,
// the consumer subtracts it from its own clock on the other core.
struct StampedPayload {
    std::uint64_t t0;
    std::uint64_t seq;
    std::uint64_t pad0;
    std::uint64_t pad1;
};
static_assert(sizeof(StampedPayload) == 32);

std::uint64_t now_ns() {
    return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(
                                          std::chrono::steady_clock::now().time_since_epoch())
                                          .count());
}

void pin_to_cpu(int cpu) {
#if defined(__linux__)
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(cpu, &set);
    pthread_setaffinity_np(pthread_self(), sizeof(set), &set);
#else
    (void)cpu;
#endif
}

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

// THE headline number: producer and consumer on separate threads, strict
// ping-pong — exactly one item in flight, so the measured round-trip is
// pure queue handoff (two cross-core cache-line transfers), never queue
// depth. Thread 0 stamps, pushes, waits for the echo; thread 1 echoes.
// Static queues: indices are monotonic counters, valid across repetitions.
void BM_SPSC_PingPongLatency(benchmark::State &state) {
    static zenith::SPSCQueue<StampedPayload, 8> req;
    static zenith::SPSCQueue<StampedPayload, 8> resp;

    pin_to_cpu(state.thread_index()); // producer → cpu0, consumer → cpu1

    StampedPayload p{};
    if (state.thread_index() == 0) {
        // Producer: round-trip latency histogram, 50 ns buckets to 10 µs.
        constexpr std::size_t kBuckets = 200;
        std::array<std::uint64_t, kBuckets + 1> hist{};
        std::uint64_t sum = 0;
        for (auto _ : state) {
            p.t0 = now_ns();
            ++p.seq;
            while (!req.try_push(p)) {
            }
            while (!resp.try_pop(p)) {
            }
            const std::uint64_t lat = now_ns() - p.t0;
            sum += lat;
            const std::size_t b = static_cast<std::size_t>(lat / 50);
            ++hist[b > kBuckets ? kBuckets : b];
        }
        const auto n = static_cast<std::uint64_t>(state.iterations());
        auto pct = [&](double q) {
            const std::uint64_t want = static_cast<std::uint64_t>(q * static_cast<double>(n));
            std::uint64_t acc = 0;
            for (std::size_t i = 0; i <= kBuckets; ++i) {
                acc += hist[i];
                if (acc >= want) {
                    return static_cast<double>(i * 50);
                }
            }
            return static_cast<double>(kBuckets * 50);
        };
        state.counters["rtt_mean_ns"] = static_cast<double>(sum) / static_cast<double>(n);
        state.counters["rtt_p50_ns"] = pct(0.50);
        state.counters["rtt_p99_ns"] = pct(0.99);
        state.counters["rtt_max_ns"] = pct(1.0);
        state.SetItemsProcessed(state.iterations());
        return;
    }

    // Consumer: echo each item straight back.
    for (auto _ : state) {
        while (!req.try_pop(p)) {
        }
        while (!resp.try_push(p)) {
        }
        benchmark::DoNotOptimize(p);
    }
    state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_SPSC_PingPongLatency)->Threads(2)->UseRealTime();

// Sustained one-way throughput across threads: producer floods, consumer
// drains. Complements ping-pong by exercising the cached-peer fast path.
void BM_SPSC_InterThreadThroughput(benchmark::State &state) {
    static zenith::SPSCQueue<StampedPayload, 4096> queue;

    pin_to_cpu(state.thread_index());

    StampedPayload p{};
    if (state.thread_index() == 0) {
        for (auto _ : state) {
            while (!queue.try_push(p)) { // fixed payload — no clock on the hot path
            }
        }
    } else {
        for (auto _ : state) {
            while (!queue.try_pop(p)) {
            }
            benchmark::DoNotOptimize(p);
        }
    }
    state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_SPSC_InterThreadThroughput)->Threads(2)->UseRealTime();

} // namespace

BENCHMARK_MAIN();
