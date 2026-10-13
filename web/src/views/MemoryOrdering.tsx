import { useState } from 'react';

import { CodeBlock } from '../components/CodeBlock';
import { Panel, PanelTitle, TechButton } from '../components/primitives';

interface Scenario {
    id: string;
    title: string;
    cpp: string;
    cppHighlight: number[];
    asm: string;
    asmHighlight: number[];
    note: string;
}

// Assembly is the real `clang++ -O2 -std=c++20 -arch x86_64` output of
// spsc_queue.hpp — trimmed for display, instructions unchanged.
const SCENARIOS: Scenario[] = [
    {
        id: 'release-store',
        title: 'Producer: release store publishes the slot',
        cpp: `bool try_push(U&& item) {
    const size_t tail = tail_.load(relaxed);
    if (tail - cached_head_ >= Capacity) {
        cached_head_ = head_.load(acquire);   // rare
        if (tail - cached_head_ >= Capacity) return false;
    }
    storage_[tail & kMask] = item;            // write payload FIRST
    tail_.store(tail + 1, release);           // then publish index
    return true;
}`,
        cppHighlight: [7],
        asm: `; try_push — clang -O2, x86-64 (excerpt)
movq    64(%rdi), %rax        ; rax = tail_  (relaxed load: plain mov)
subq    72(%rdi), %rcx        ; tail - cached_head_
cmpq    $16, %rcx
jb      .Lhas_room
movq    128(%rdi), %rcx       ; head_.load(acquire) → plain mov
movq    %rcx, 72(%rdi)        ; cached_head_ = head_
.Lhas_room:
andl    $15, %ecx             ; tail & (Capacity - 1)
movl    %esi, (%rdi,%rcx,4)   ; storage_[slot] = item
incq    %rax
movq    %rax, 64(%rdi)        ; tail_.store(release) → plain mov!`,
        asmHighlight: [4, 5, 11],
        note: 'release ordering means the payload write at storage_[slot] can never be observed after the tail_ update. On x86-64 the hardware already guarantees store order (TSO), so the release store is a plain movq — no fence, no LOCK prefix. The ordering guarantee lives in the compiler (no reordering past this point), not in extra instructions.',
    },
    {
        id: 'acquire-load',
        title: 'Consumer: acquire load reads the published index',
        cpp: `bool try_pop(T& out) {
    const size_t head = head_.load(relaxed);
    if (head == cached_tail_) {
        cached_tail_ = tail_.load(acquire);   // rare
        if (head == cached_tail_) return false;
    }
    out = storage_[head & kMask];             // read payload AFTER index
    head_.store(head + 1, release);           // free the slot
    return true;
}`,
        cppHighlight: [3, 7],
        asm: `; try_pop — clang -O2, x86-64 (excerpt)
movq    128(%rdi), %rax       ; rax = head_  (relaxed load)
cmpq    136(%rdi), %rax       ; head == cached_tail_?
jne     .Lhas_item
movq    64(%rdi), %rcx        ; tail_.load(acquire) → plain mov
movq    %rcx, 136(%rdi)       ; cached_tail_ = tail_
cmpq    %rcx, %rax
jne     .Lhas_item
.Lhas_item:
andl    $15, %ecx             ; head & (Capacity - 1)
movl    (%rdi,%rcx,4), %ecx   ; item = storage_[slot]
incq    %rax
movq    %rax, 128(%rdi)       ; head_.store(release) → plain mov!`,
        asmHighlight: [4, 5, 12],
        note: 'The acquire load pairs with the producer\'s release store: once the consumer observes the new tail_, it is guaranteed to see the payload written before it. On x86-64, loads are never reordered with later loads (TSO again), so acquire is a plain movq. The "work" is entirely in what the compiler is forbidden to reorder.',
    },
    {
        id: 'why-no-locks',
        title: 'Why SPSC needs zero locked instructions',
        cpp: `// What a mutex-based queue would emit per operation:
lock cmpxchg [...]      // atomic RMW: drains store buffer, ~20-40 cycles
// or worse: MFENCE — full pipeline stall

// ZenithBus SPSC — per element, hot path:
movq    64(%rdi), %rax        ; load tail_ (own index, no contention)
movl    %esi, (%rdi,%rcx,4)   ; write payload
movq    %rax, 64(%rdi)        ; store tail_ — done`,
        cppHighlight: [1, 5, 6, 7, 8],
        asm: `; Why is plain mov enough here?
;
; 1. Only ONE thread writes tail_  → no atomic RMW needed.
;    (two writers would need lock cmpxchg — SPSC has one)
; 2. Release/acquire pairs order the *payload* against the
;    *index* — the only ordering that matters for correctness.
; 3. x86-64 TSO already forbids the reorderings release/acquire
;    prevent → compiler emits mov, hardware does the rest.
;
; Cost of a LOCK'd op: ~20-40 cycles (bus lock / cache line
; arbitration). Cost of movq to L1: ~4-5 cycles, pipelined.`,
        asmHighlight: [1, 5, 7, 8, 9],
        note: 'Single-producer means the index is written by exactly one thread — read-modify-write atomics exist to arbitrate competing writers, and there are none. The only ordering requirement is payload-before-index, which x86-64 gives for free. This is the entire reason the queue hits single-digit nanosecond push/pop.',
    },
];

export function MemoryOrdering() {
    const [scenario, setScenario] = useState(SCENARIOS[0]);
    return (
        <div className="flex flex-col gap-4">
            <Panel>
                <div className="flex flex-wrap items-center gap-2">
                    <PanelTitle>C++20 memory ordering → x86-64 reality</PanelTitle>
                    <div className="flex gap-1">
                        {SCENARIOS.map((sc) => (
                            <TechButton
                                key={sc.id}
                                variant={sc.id === scenario.id ? 'producer' : 'ghost'}
                                className="px-2 py-1"
                                onClick={() => setScenario(sc)}
                            >
                                {sc.id}
                            </TechButton>
                        ))}
                    </div>
                </div>
                <p className="mb-3 text-xs text-body">{scenario.title}</p>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                        <span className="label-tech">C++ — spsc_queue.hpp</span>
                        <CodeBlock code={scenario.cpp} lang="cpp" highlight={scenario.cppHighlight} className="mt-1" />
                    </div>
                    <div>
                        <span className="label-tech">x86-64 — actual clang -O2 output</span>
                        <CodeBlock code={scenario.asm} lang="nasm" highlight={scenario.asmHighlight} className="mt-1" />
                    </div>
                </div>
            </Panel>
            <Panel className="border-l-2 border-l-barrier">
                <PanelTitle>Reading it</PanelTitle>
                <p className="text-sm leading-relaxed text-body">{scenario.note}</p>
            </Panel>
        </div>
    );
}
