# Architecture and Memory Model

## SPSC queue mechanics

A single-producer/single-consumer queue needs no mutual exclusion because
each index has exactly one writer:

- `tail_` is written **only** by the producer.
- `head_` is written **only** by the consumer.

Mutexes and CAS retry loops exist to arbitrate *competing writers*. With one
writer per index there is no arbitration to do — each side performs a plain
load, checks a bound, writes the slot, and publishes its own index with a
store. The queue is bounded (`std::array<T, Capacity>`), so `try_push` fails
on full and `try_pop` fails on empty instead of blocking.

Wrap-around costs one AND: `slot = index & (Capacity - 1)`, valid because
`Capacity` is a compile-time power of two ≥ 2 (enforced by `static_assert`).

## Cache-line false sharing

`head_` and `tail_` are written by *different* cores on every operation. If
they shared a 64-byte L1 line, every write would invalidate the peer core's
copy and the line would ping-pong between cores through the MESI protocol —
~40–100 cycles per bounce, invisible in the code.

ZenithBus places each index on its own line:

```text
Cache line 0 (0x00–0x3F)          Cache line 1 (0x40–0x7F)
┌─────────────────────────────┐   ┌─────────────────────────────┐
│ head_ (8B)  cached_tail_(8B)│   │ tail_ (8B)  cached_head_(8B)│
│ consumer-owned, written     │   │ producer-owned, written     │
│ only by consumer            │   │ only by producer            │
└─────────────────────────────┘   └─────────────────────────────┘
        alignas(64)                      alignas(64)
```

Each line has a single writer core. The peer's *reads* pull the line into
Shared state briefly, but no line ever bounces under write contention.

## Acquire-release ordering

Correctness reduces to one question: can the consumer read a slot before the
producer has finished writing it? The release/acquire pair on `tail_`
answers no.

Producer (`try_push`):

```cpp
storage_[tail & kMask] = item;              // 1. write payload first
tail_.store(tail + 1, memory_order_release); // 2. publish index AFTER
```

Consumer (`try_pop`):

```cpp
if (head == cached_tail_)                   // 3. read index ...
    cached_tail_ = tail_.load(memory_order_acquire); // ... with acquire
out = storage_[head & kMask];               // 4. read payload
```

The release/acquire pair forms a synchronizes-with edge: everything the
producer wrote *before* the release store — including the payload — is
visible to any thread whose acquire load observes that store's value. So a
consumer that sees `tail_ = k+1` is guaranteed to see the slot `k` payload.

On x86-64 this is free: TSO already forbids StoreLoad reordering of ordinary
loads/stores, so both atomic ops compile to plain `movq` — verified real
output:

```asm
movl    %esi, (%rdi,%rcx,4)   ; storage_[slot] = item
incq    %rax
movq    %rax, 64(%rdi)        ; tail_.store(release) → plain movq
```

The ordering work happens at compile time — the compiler may not hoist the
payload store past the release store — not in emitted instructions.

## Cached peer indices

Reading the other thread's index is the only cross-core operation, and it's
kept off the hot path:

- The producer keeps `cached_head_` — a local snapshot of `head_` on *its
  own* cache line. Fullness is checked as `tail - cached_head_ >= Capacity`;
  the real `head_.load(acquire)` runs only when the snapshot says full.
- The consumer mirrors this with `cached_tail_` for the empty check.

Since `head` only grows, a stale `cached_head_` merely *overestimates*
fullness — safe. While the queue is neither full nor empty, neither side
touches a shared atomic at all: pure local arithmetic plus one plain store.

## EventBus fan-out

`EventBus<T, Capacity, MaxSubscribers>` holds a preallocated
`std::array<SPSCQueue<T, Capacity>, MaxSubscribers>` and an atomic
`subscriber_count_`. `subscribe()` claims a slot with a compare-exchange
loop (retry until the count is < `MaxSubscribers` or fail) so a racing
`publish()` can never observe an out-of-range count — and returns the queue
index as a handle. Do it during setup, before publishing.

`publish()` performs one `try_push` per subscriber: non-blocking, so a full
subscriber queue drops that event for that subscriber only (returns
`false`). `publish_wait()` spins with `std::this_thread::yield()` until
every queue accepts — exactly-once fan-out for workloads that cannot drop.
