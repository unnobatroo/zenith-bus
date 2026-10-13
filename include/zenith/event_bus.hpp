// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

#pragma once

#include "zenith/concepts.hpp"
#include "zenith/spsc_queue.hpp"

#include <array>
#include <atomic>
#include <cstddef>
#include <stdexcept>
#include <thread>

namespace zenith {

// Fan-out dispatcher: each subscriber owns a dedicated SPSC queue and
// receives every published event. Pre-allocated queues mean zero dynamic
// allocation during dispatch. Call subscribe() during setup, before
// publishing begins.
template <TriviallyRelocatable T, std::size_t QueueCapacity, std::size_t MaxSubscribers = 8>
class EventBus {
  public:
    EventBus() = default;
    ~EventBus() = default;
    EventBus(const EventBus &) = delete;
    EventBus &operator=(const EventBus &) = delete;

    // Reserves a subscriber queue and returns its handle.
    // Throws std::length_error once MaxSubscribers is reached.
    [[nodiscard]] std::size_t subscribe() {
        // CAS so the count never exceeds MaxSubscribers even transiently —
        // a racing publish() must never see an out-of-bounds queue index.
        std::size_t id = subscriber_count_.load(std::memory_order_relaxed);
        for (;;) {
            if (id >= MaxSubscribers) {
                throw std::length_error("zenith::EventBus subscriber limit reached");
            }
            if (subscriber_count_.compare_exchange_weak(id, id + 1, std::memory_order_acq_rel,
                                                        std::memory_order_relaxed)) {
                return id;
            }
        }
    }

    // Non-blocking broadcast: one push attempt per subscriber queue.
    // Returns false if any queue was full — that subscriber drops the event
    // while others may already have received it. For guaranteed delivery to
    // every subscriber use publish_wait().
    bool publish(const T &event) noexcept {
        bool all_delivered = true;
        const std::size_t n = subscriber_count_.load(std::memory_order_acquire);
        for (std::size_t i = 0; i < n; ++i) {
            all_delivered = queues_[i].try_push(event) && all_delivered;
        }
        return all_delivered;
    }

    // Guaranteed broadcast: spins (yielding) until every subscriber queue
    // accepts the event. Blocks if a subscriber stops draining.
    void publish_wait(const T &event) noexcept {
        const std::size_t n = subscriber_count_.load(std::memory_order_acquire);
        for (std::size_t i = 0; i < n; ++i) {
            while (!queues_[i].try_push(event)) {
                std::this_thread::yield();
            }
        }
    }

    bool poll(std::size_t sub_id, T &out_event) noexcept {
        if (sub_id >= subscriber_count_.load(std::memory_order_acquire)) {
            return false;
        }
        return queues_[sub_id].try_pop(out_event);
    }

    // Pops every currently queued event for the subscriber, passing each to
    // callback. Returns the number of events processed.
    template <typename Callback> std::size_t drain(std::size_t sub_id, Callback &&callback) {
        std::size_t processed = 0;
        T event;
        while (poll(sub_id, event)) {
            callback(event);
            ++processed;
        }
        return processed;
    }

    [[nodiscard]] std::size_t subscriber_count() const noexcept {
        return subscriber_count_.load(std::memory_order_acquire);
    }

  private:
    std::array<SPSCQueue<T, QueueCapacity>, MaxSubscribers> queues_;
    alignas(64) std::atomic<std::size_t> subscriber_count_{0};
};

} // namespace zenith
