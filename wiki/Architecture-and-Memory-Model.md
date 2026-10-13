# Architecture and Memory Model

## The queue, in one paragraph

`SPSCQueue` is a fixed-size ring buffer with two counters: `tail_` (where the
producer writes next) and `head_` (where the consumer reads next). Slot index
is `counter & (Capacity - 1)` — that's why capacity must be a power of two.
The counters never wrap or reset; they grow forever and the mask picks the
slot. `tail - head` is the number of items in the queue.

## Why no lock is needed

Each counter has exactly one writer. The producer only writes `tail_`, the
consumer only writes `head_`. Each reads the other's counter, never writes
it. With single ownership there's no write-write race, so no mutex and no
CAS retry loop — just atomic loads and stores.

## The ordering, step by step

```cpp
// producer
storage_[tail & mask] = item;                        // 1. write data
tail_.store(tail + 1, std::memory_order_release);    // 2. publish it

// consumer
tail = tail_.load(std::memory_order_acquire);        // 3. observe index
out  = storage_[head & mask];                        // 4. read data
head_.store(head + 1, std::memory_order_release);    // 5. free the slot
```

The rule: step 2's release store guarantees everything written *before* it
(step 1) is visible to any thread that acquire-loads the new value (step 3).
So the consumer can never see `tail_` advance without seeing the payload.
Step 5 mirrors it for the free path. This is the acquire-release pattern —
the cheapest correct ordering.

On x86-64 all of this compiles to plain `mov` (the hardware already provides
that ordering); on ARM64 you get real `ldapr`/`stlr` instructions. No locks,
no fences, no compare-exchange anywhere.

## Cache lines and false sharing

`tail_` and `head_` are written by different threads constantly. If they sat
on the same 64-byte cache line, every write would invalidate the other core's
copy — the MESI coherence protocol would ping-pong the line between cores on
every single operation. `alignas(64)` puts each on its own line.

Not just theory: the repo ships `bench_event_bus_nopad` (same code built
with `ZENITH_NO_CACHELINE_PAD`). Measured on an M-series laptop: throughput
drops ~6–30% run to run (macOS can't pin threads, so results float); the
`perf-false-sharing` CI job counts the actual L1 misses on x86-64.

## The cached peer indices

`try_push` must check "is it full?" which needs `head_` — an atomic owned by
the consumer on another core. Loading it every push means an L1-hit-but-
remote-invalidated read every time. Instead the producer keeps
`cached_head_`, a plain non-atomic copy. It only does the real acquire load
when the cache says the queue is full — which is almost never. The consumer
mirrors this with `cached_tail_`. Empty/full checks are the *only* moments
the threads actually talk.

## EventBus fan-out

`EventBus<T, Capacity, MaxSubscribers>` holds
`std::array<SPSCQueue<T, Capacity>, MaxSubscribers>` plus an atomic
subscriber count. `subscribe()` reserves a slot with a compare-exchange loop
(so a racing `publish()` can never see an out-of-range count) and returns the
index as a handle. `publish()` iterates the active queues and `try_push`es
the event into each — one pass, one branch per queue, no allocation.

Partial delivery is real: if queue 2 is full, queues 0 and 1 still got the
event and `publish()` returns `false`. Retrying the same event would
duplicate it to 0 and 1. Use `publish_wait()` when every subscriber must get
every event — it spins until they all accept.
