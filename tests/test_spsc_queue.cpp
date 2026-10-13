// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

#include <gtest/gtest.h>

#include "zenith/spsc_queue.hpp"

#include <atomic>
#include <cstdint>
#include <thread>

namespace {

constexpr std::size_t kCap = 8;

TEST(SPSCQueue, EmptyOnConstruction) {
    zenith::SPSCQueue<int, kCap> queue;
    EXPECT_TRUE(queue.empty());
    EXPECT_EQ(queue.size_approx(), 0);
    int out = 0;
    EXPECT_FALSE(queue.try_pop(out));
}

TEST(SPSCQueue, TryPushTryPopPreservesOrder) {
    zenith::SPSCQueue<int, kCap> queue;
    ASSERT_TRUE(queue.try_push(1));
    ASSERT_TRUE(queue.try_push(2));
    ASSERT_TRUE(queue.try_push(3));
    EXPECT_EQ(queue.size_approx(), 3);

    int out = 0;
    EXPECT_TRUE(queue.try_pop(out));
    EXPECT_EQ(out, 1);
    EXPECT_TRUE(queue.try_pop(out));
    EXPECT_EQ(out, 2);
    EXPECT_TRUE(queue.try_pop(out));
    EXPECT_EQ(out, 3);
    EXPECT_TRUE(queue.empty());
}

TEST(SPSCQueue, FullQueueRejectsPush) {
    zenith::SPSCQueue<int, kCap> queue;
    for (int i = 0; i < static_cast<int>(kCap); ++i) {
        ASSERT_TRUE(queue.try_push(i));
    }
    EXPECT_EQ(queue.size_approx(), kCap);
    EXPECT_FALSE(queue.try_push(99));

    int out = 0;
    ASSERT_TRUE(queue.try_pop(out));
    EXPECT_TRUE(queue.try_push(99));
}

TEST(SPSCQueue, IndexWrapAroundPreservesOrder) {
    zenith::SPSCQueue<int, kCap> queue;
    int out = 0;
    // Push/pop cycles well past one wrap of the bitmask.
    for (int i = 0; i < static_cast<int>(kCap * 3); ++i) {
        ASSERT_TRUE(queue.try_push(i));
        ASSERT_TRUE(queue.try_pop(out));
        EXPECT_EQ(out, i);
    }
}

TEST(SPSCQueue, RValuePush) {
    zenith::SPSCQueue<int, kCap> queue;
    int value = 7;
    ASSERT_TRUE(queue.try_push(std::move(value)));
    int out = 0;
    ASSERT_TRUE(queue.try_pop(out));
    EXPECT_EQ(out, 7);
}

TEST(SPSCQueue, ConcurrentProducerConsumer) {
    constexpr std::int64_t kTotal = 2'000'000;
    zenith::SPSCQueue<std::int64_t, 1024> queue;
    std::atomic<bool> producer_done{false};
    std::atomic<int> errors{0};

    std::thread producer([&] {
        for (std::int64_t i = 0; i < kTotal; ++i) {
            while (!queue.try_push(i)) {
                std::this_thread::yield();
            }
        }
        producer_done.store(true, std::memory_order_release);
    });

    std::thread consumer([&] {
        std::int64_t expected = 0;
        std::int64_t value = 0;
        while (expected < kTotal) {
            if (queue.try_pop(value)) {
                if (value != expected) {
                    errors.fetch_add(1, std::memory_order_relaxed);
                    break;
                }
                ++expected;
            } else if (producer_done.load(std::memory_order_acquire)) {
                // Producer finished; a missing value means a real loss.
                if (!queue.try_pop(value)) {
                    break;
                }
            } else {
                std::this_thread::yield();
            }
        }
    });

    producer.join();
    consumer.join();
    EXPECT_EQ(errors.load(), 0);
}

} // namespace
