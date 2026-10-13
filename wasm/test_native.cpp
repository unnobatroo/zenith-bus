// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

// Native smoke test for the binding layer — exercises the same extern "C"
// surface JS will call, verifying the private->public probes return real
// internal state. Build: clang++ -std=c++20 -I../include zenith_api.cpp
// test_native.cpp -o test_native
#include <cassert>
#include <chrono>
#include <cstdio>
#include <thread>

extern "C" {
void zq_set_capacity(int);
void zq_reset();
int zq_push(unsigned);
int zq_pop();
double zq_head();
double zq_tail();
double zq_cached_head();
double zq_cached_tail();
double zq_size();
int zq_capacity();
unsigned zq_slot_value(int);
void zb_reset();
int zb_subscribe();
int zb_publish(double, double, float, float, float);
int zb_drain(int);
double zb_drain_ts(int);
double zb_last_field(int, int);
int zb_occupancy(int);
int zb_subscriber_count();
void zq_rt_start(double, double);
void zb_rt_start(double, double, double, double);
void rt_stop();
int rt_running();
double rt_pushed();
double rt_popped();
double rt_push_fail();
double rt_pop_fail();
double rt_published();
double rt_pub_fail();
double rt_drained(int);
}

int main() {
    // --- SPSC queue ---
    zq_set_capacity(8);
    assert(zq_capacity() == 8);
    assert(zq_push(100) == 1);
    assert(zq_tail() == 1 && zq_head() == 0);
    assert(zq_slot_value(0) == 100);
    assert(zq_pop() == 100);
    assert(zq_head() == 1);
    assert(zq_pop() == -1); // empty

    // Fill to capacity → cached_head_ reload path must trigger.
    zq_reset();
    for (unsigned i = 0; i < 8; ++i)
        assert(zq_push(i) == 1);
    assert(zq_push(99) == 0);              // full
    assert(zq_cached_head() == zq_head()); // reload happened on the failed push
    assert(zq_pop() == 0);
    assert(zq_push(99) == 1); // room again

    // --- Event bus ---
    zb_reset();
    const int a = zb_subscribe();
    const int b = zb_subscribe();
    assert(a == 0 && b == 1 && zb_subscriber_count() == 2);

    int r = zb_publish(1, 10.0, 12.5f, 0.1f, 0.2f);
    assert((r & 1) == 1); // delivered to all
    assert(zb_occupancy(0) == 1 && zb_occupancy(1) == 1);

    // Fill queue 0 completely, then publish → partial delivery flagged.
    while (zb_occupancy(0) < 16)
        zb_publish(2, 20.0, 1.f, 0.f, 0.f);
    r = zb_publish(3, 30.0, 1.f, 0.f, 0.f);
    assert((r & 1) == 0); // not all delivered
    assert((r >> 1) & 1); // queue 0 reported full

    const int n = zb_drain(0);
    assert(n == 16);
    assert(zb_drain_ts(0) == 10.0);     // first packet was ts=10
    assert(zb_last_field(0, 0) == 2.0); // last drained seq
    assert(zb_occupancy(0) == 0);

    // --- Real threaded mode: actual producer/consumer threads on the queue ---
    zq_reset();
    zq_rt_start(0, 0); // flat out
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    rt_stop();
    const double pushed = rt_pushed(), popped = rt_popped();
    assert(pushed > 1000 && popped > 1000);
    assert(pushed == popped + zq_size()); // conservation: in-flight = pushed - popped
    assert(rt_running() == 0);

    // Mutation guards: ignored while threads run.
    zq_rt_start(0, 0);
    zq_set_capacity(32);
    zq_reset();
    rt_stop();
    assert(zq_capacity() == 8);

    // --- Bus threaded mode ---
    zb_reset();
    assert(zb_subscribe() == 0 && zb_subscribe() == 1 && zb_subscribe() == 2);
    zb_rt_start(0, 0, 200, 0); // fast, slow, flat
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    rt_stop();
    // Flat-out publisher with a 200 Hz drainer: most publishes partially
    // fail (slow queue stays full) — that's the API's real semantics.
    assert(rt_published() + rt_pub_fail() > 1000);
    assert(rt_pub_fail() > rt_published());
    assert(rt_drained(0) > 1000); // fast consumer keeps up regardless
    for (int s = 0; s < 3; ++s) {
        // partial-failure publishes still deliver to fast queues, so a
        // queue's deliveries are bounded by total publish ATTEMPTS.
        const double rem = zb_occupancy(s);
        assert(rt_drained(s) + rem <= rt_published() + rt_pub_fail());
    }

    std::puts("native binding test: all assertions passed");
    return 0;
}
