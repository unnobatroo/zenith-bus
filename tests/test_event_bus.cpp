// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

#include <gtest/gtest.h>

#include "zenith/event_bus.hpp"

#include <atomic>
#include <cstdint>
#include <fmt/core.h>
#include <stdexcept>
#include <thread>
#include <vector>

namespace {

TEST(EventBus, SubscribeAssignsSequentialIds) {
    zenith::EventBus<int, 64> bus;
    EXPECT_EQ(bus.subscribe(), 0);
    EXPECT_EQ(bus.subscribe(), 1);
    EXPECT_EQ(bus.subscriber_count(), 2);
}

TEST(EventBus, SubscribeBeyondLimitThrows) {
    zenith::EventBus<int, 64, 2> bus;
    (void)bus.subscribe();
    (void)bus.subscribe();
    EXPECT_THROW((void)bus.subscribe(), std::length_error);
    EXPECT_EQ(bus.subscriber_count(), 2);
}

TEST(EventBus, PublishFansOutToAllSubscribers) {
    zenith::EventBus<int, 64> bus;
    const auto first = bus.subscribe();
    const auto second = bus.subscribe();

    ASSERT_TRUE(bus.publish(42));

    int out = 0;
    ASSERT_TRUE(bus.poll(first, out));
    EXPECT_EQ(out, 42);
    ASSERT_TRUE(bus.poll(second, out));
    EXPECT_EQ(out, 42);
}

TEST(EventBus, PollOnEmptyOrInvalidReturnsFalse) {
    zenith::EventBus<int, 64> bus;
    const auto sub = bus.subscribe();
    int out = 0;
    EXPECT_FALSE(bus.poll(sub, out));
    EXPECT_FALSE(bus.poll(99, out));
}

TEST(EventBus, PublishWithNoSubscribersSucceeds) {
    zenith::EventBus<int, 64> bus;
    EXPECT_TRUE(bus.publish(1));
}

TEST(EventBus, PublishReturnsFalseWhenAQueueIsFull) {
    zenith::EventBus<int, 4> bus;
    const auto full_sub = bus.subscribe();
    const auto open_sub = bus.subscribe();

    for (int i = 0; i < 4; ++i) {
        ASSERT_TRUE(bus.publish(i));
    }
    // Both queues are full now: next publish fails, and partial delivery is
    // still visible to queues that were not yet full.
    EXPECT_FALSE(bus.publish(100));

    int out = 0;
    std::size_t seen = 0;
    while (bus.poll(open_sub, out)) {
        ++seen;
    }
    EXPECT_EQ(seen, 4);
    (void)full_sub;
}

TEST(EventBus, DrainProcessesAllQueuedEvents) {
    zenith::EventBus<int, 64> bus;
    const auto sub = bus.subscribe();
    for (int i = 0; i < 10; ++i) {
        ASSERT_TRUE(bus.publish(i));
    }

    int sum = 0;
    const std::size_t processed = bus.drain(sub, [&](int v) { sum += v; });
    EXPECT_EQ(processed, 10);
    EXPECT_EQ(sum, 45);

    int out = 0;
    EXPECT_FALSE(bus.poll(sub, out));
}

TEST(EventBus, StressSequentialIntegersTwoSubscribers) {
    constexpr std::int64_t kTotal = 10'000'000;
    zenith::EventBus<std::int64_t, 4096> bus;
    const auto sub_a = bus.subscribe();
    const auto sub_b = bus.subscribe();

    std::atomic<bool> producer_done{false};
    std::atomic<int> errors{0};
    std::vector<std::int64_t> received(2, 0);

    auto consume = [&](std::size_t sub_id, int slot) {
        std::int64_t expected = 0;
        std::int64_t value = 0;
        while (expected < kTotal) {
            if (bus.poll(sub_id, value)) {
                if (value != expected) {
                    errors.fetch_add(1, std::memory_order_relaxed);
                    return;
                }
                ++expected;
            } else if (producer_done.load(std::memory_order_acquire) && !bus.poll(sub_id, value)) {
                // Producer finished and the queue is drained: anything still
                // missing is a real loss.
                return;
            } else {
                std::this_thread::yield();
            }
        }
        received[static_cast<std::size_t>(slot)] = expected;
    };

    std::thread consumer_a(consume, sub_a, 0);
    std::thread consumer_b(consume, sub_b, 1);

    std::thread producer([&] {
        for (std::int64_t i = 0; i < kTotal; ++i) {
            bus.publish_wait(i);
        }
        producer_done.store(true, std::memory_order_release);
    });

    producer.join();
    consumer_a.join();
    consumer_b.join();

    fmt::print("stress: delivered {} messages x 2 subscribers\n", kTotal);
    EXPECT_EQ(errors.load(), 0);
    EXPECT_EQ(received[0], kTotal);
    EXPECT_EQ(received[1], kTotal);
}

} // namespace
