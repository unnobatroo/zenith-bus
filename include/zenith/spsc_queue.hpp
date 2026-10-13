// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

#pragma once

#include "zenith/concepts.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <utility>

// alignas(64) on producer/consumer state keeps each index on its own cache
// line. Build benchmarks with -DZENITH_NO_CACHELINE_PAD to measure the
// false-sharing cost directly (see the perf-stat CI job).
#if defined(ZENITH_NO_CACHELINE_PAD)
#define ZENITH_CACHELINE
#else
#define ZENITH_CACHELINE alignas(64)
#endif

namespace zenith {

// Bounded lock-free single-producer/single-consumer ring buffer, modeled on
// folly::ProducerConsumerQueue / moodycamel::ReaderWriterQueue: head and
// tail live on separate cache lines and each side caches the peer index so
// acquire loads stay off the hot path.
template <TriviallyRelocatable T, std::size_t Capacity> class SPSCQueue {
    static_assert(Capacity >= 2, "Capacity must be at least 2");
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be a power of two");

  public:
    SPSCQueue() = default;
    ~SPSCQueue() = default;
    SPSCQueue(const SPSCQueue &) = delete;
    SPSCQueue &operator=(const SPSCQueue &) = delete;

    // Returns false when the queue is full.
    bool try_push(const T &item) noexcept { return emplace(item); }
    bool try_push(T &&item) noexcept { return emplace(std::move(item)); }

    // Returns false when the queue is empty.
    bool try_pop(T &out_item) noexcept {
        const std::size_t head = head_.load(std::memory_order_relaxed);
        if (head == cached_tail_) {
            cached_tail_ = tail_.load(std::memory_order_acquire);
            if (head == cached_tail_) {
                return false;
            }
        }
        out_item = storage_[head & kMask];
        head_.store(head + 1, std::memory_order_release);
        return true;
    }

    // Approximate: the peer index may move concurrently.
    [[nodiscard]] std::size_t size_approx() const noexcept {
        const std::size_t head = head_.load(std::memory_order_relaxed);
        const std::size_t tail = tail_.load(std::memory_order_relaxed);
        return std::min(tail - head, Capacity);
    }

    [[nodiscard]] bool empty() const noexcept { return size_approx() == 0; }

  private:
    static constexpr std::size_t kMask = Capacity - 1;

    template <typename U> bool emplace(U &&item) noexcept {
        const std::size_t tail = tail_.load(std::memory_order_relaxed);
        if (tail - cached_head_ >= Capacity) {
            cached_head_ = head_.load(std::memory_order_acquire);
            if (tail - cached_head_ >= Capacity) {
                return false;
            }
        }
        // TriviallyRelocatable → copy-assign is optimal; also keeps
        // try_push(T&&) working for payloads with a deleted move-assign.
        storage_[tail & kMask] = item;
        tail_.store(tail + 1, std::memory_order_release);
        return true;
    }

    ZENITH_CACHELINE std::array<T, Capacity> storage_;

    // Producer-owned line: written only by the producing thread.
    ZENITH_CACHELINE std::atomic<std::size_t> tail_{0};
    std::size_t cached_head_{0};

    // Consumer-owned line: written only by the consuming thread.
    ZENITH_CACHELINE std::atomic<std::size_t> head_{0};
    std::size_t cached_tail_{0};
};

} // namespace zenith
