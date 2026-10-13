// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

// Native smoke test for the binding layer — exercises the same extern "C"
// surface JS will call, verifying the private->public probes return real
// internal state. Build: clang++ -std=c++20 -I../include zenith_api.cpp
// test_native.cpp -o test_native
#include <cassert>
#include <cstdio>

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

    std::puts("native binding test: all assertions passed");
    return 0;
}
