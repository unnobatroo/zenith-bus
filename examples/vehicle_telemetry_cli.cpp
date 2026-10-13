// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

// Simulated vehicle telemetry fan-out: one producer streams sensor packets
// at a fixed cadence to independent consumer threads via the event bus.

#include "zenith/event_bus.hpp"

#include <CLI/CLI.hpp>
#include <fmt/core.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <string>
#include <thread>
#include <vector>

namespace {

struct TelemetryPacket {
    std::uint64_t sequence;
    std::int64_t timestamp_ns;
    std::uint32_t vehicle_id;
    float speed_mps;
    float steering_rad;
};

static_assert(zenith::TriviallyRelocatable<TelemetryPacket>);

constexpr std::size_t kMaxSubscribers = 8;
constexpr float kSafetySpeedLimit = 40.0F;
constexpr float kSafetySteeringLimit = 0.9F;

std::string subscriber_name(std::size_t id) {
    switch (id) {
    case 0:
        return "SafetyMonitor";
    case 1:
        return "TelemetryLogger";
    default:
        return fmt::format("Subscriber-{}", id);
    }
}

} // namespace

int main(int argc, char **argv) {
    int subscribers = 2;
    int rate_hz = 1000;
    int duration_sec = 5;

    CLI::App app{"ZenithBus vehicle telemetry fan-out demo"};
    app.add_option("--subscribers", subscribers, "Number of subscriber threads")
        ->check(CLI::Range(1, static_cast<int>(kMaxSubscribers)));
    app.add_option("--rate-hz", rate_hz, "Producer message rate in Hz")
        ->check(CLI::Range(1, 100'000));
    app.add_option("--duration-sec", duration_sec, "Stream duration in seconds")
        ->check(CLI::Range(1, 3600));
    CLI11_PARSE(app, argc, argv);

    zenith::EventBus<TelemetryPacket, 1024, kMaxSubscribers> bus;

    std::vector<std::size_t> sub_ids;
    sub_ids.reserve(static_cast<std::size_t>(subscribers));
    for (int i = 0; i < subscribers; ++i) {
        sub_ids.push_back(bus.subscribe());
    }

    const std::uint64_t total_packets =
        static_cast<std::uint64_t>(rate_hz) * static_cast<std::uint64_t>(duration_sec);

    fmt::print("Streaming {} packets at {} Hz to {} subscriber(s)\n", total_packets, rate_hz,
               subscribers);

    std::atomic<bool> producer_done{false};
    std::atomic<std::uint64_t> dropped_attempts{0};
    std::vector<std::atomic<std::uint64_t>> received(static_cast<std::size_t>(subscribers));
    std::vector<std::atomic<std::uint64_t>> violations(static_cast<std::size_t>(subscribers));

    std::vector<std::jthread> consumers;
    consumers.reserve(static_cast<std::size_t>(subscribers));
    for (std::size_t i = 0; i < static_cast<std::size_t>(subscribers); ++i) {
        consumers.emplace_back([&, i] {
            const std::size_t sub_id = sub_ids[i];
            while (!producer_done.load(std::memory_order_acquire)) {
                const std::size_t n = bus.drain(sub_id, [&](const TelemetryPacket &p) {
                    received[i].fetch_add(1, std::memory_order_relaxed);
                    if (i == 0 &&
                        (p.speed_mps > kSafetySpeedLimit || p.steering_rad > kSafetySteeringLimit ||
                         p.steering_rad < -kSafetySteeringLimit)) {
                        violations[i].fetch_add(1, std::memory_order_relaxed);
                    }
                });
                if (n == 0) {
                    std::this_thread::yield();
                }
            }
            // Final drain after the producer stops.
            bus.drain(sub_id, [&](const TelemetryPacket &p) {
                received[i].fetch_add(1, std::memory_order_relaxed);
                if (i == 0 &&
                    (p.speed_mps > kSafetySpeedLimit || p.steering_rad > kSafetySteeringLimit ||
                     p.steering_rad < -kSafetySteeringLimit)) {
                    violations[i].fetch_add(1, std::memory_order_relaxed);
                }
            });
        });
    }

    const auto tick = std::chrono::nanoseconds{1'000'000'000 / rate_hz};
    auto next = std::chrono::steady_clock::now();
    for (std::uint64_t seq = 0; seq < total_packets; ++seq) {
        const auto now = std::chrono::system_clock::now().time_since_epoch();
        const TelemetryPacket packet{
            seq,
            std::chrono::duration_cast<std::chrono::nanoseconds>(now).count(),
            42,
            10.0F + static_cast<float>(seq % 50),      // ramps 10..60 m/s
            0.5F * ((seq % 200) < 100 ? 1.0F : -1.0F), // gentle oscillation
        };
        if (!bus.publish(packet)) {
            dropped_attempts.fetch_add(1, std::memory_order_relaxed);
        }
        next += tick;
        std::this_thread::sleep_until(next);
    }
    producer_done.store(true, std::memory_order_release);

    for (auto &t : consumers) {
        t.join();
    }

    for (std::size_t i = 0; i < static_cast<std::size_t>(subscribers); ++i) {
        const auto got = received[i].load();
        const auto lost = total_packets - got;
        fmt::print("{:<16} received {:>8} lost {:>8} violations {:>5}\n", subscriber_name(i), got,
                   lost, violations[i].load());
    }
    fmt::print("Partial-failure publishes: {}\n", dropped_attempts.load());
    return 0;
}
