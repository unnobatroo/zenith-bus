import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Cpu, Info } from 'lucide-react';
import { useEffect } from 'react';

import { Panel } from './components/primitives';
import { CacheInspector } from './views/CacheInspector';
import { EventBusPipeline } from './views/EventBusPipeline';
import { MemoryOrdering } from './views/MemoryOrdering';
import { RingBufferPlayground } from './views/RingBufferPlayground';
import { useSimulationStore } from './store/useSimulationStore';
import { cn } from './lib/utils';

const TICK_MS = 50;

const TABS = [
    { id: 'ring', label: 'Ring Buffer' },
    { id: 'cache', label: 'Cache Lines' },
    { id: 'bus', label: 'Event Bus' },
    { id: 'asm', label: 'Memory Ordering' },
];

export function App() {
    const init = useSimulationStore((s) => s.init);
    const ready = useSimulationStore((s) => s.ready);
    const tick = useSimulationStore((s) => s.tick);

    useEffect(() => {
        void init();
    }, [init]);

    useEffect(() => {
        const id = setInterval(() => tick(TICK_MS), TICK_MS);
        return () => clearInterval(id);
    }, [tick]);

    return (
        <TooltipPrimitive.Provider delayDuration={200}>
            <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
                <header className="mb-5 flex items-start justify-between border-b border-rule-strong pb-4">
                    <div>
                        <h1 className="heading-ink flex items-center gap-2 text-2xl">
                            <Cpu size={22} className="text-barrier" /> ZenithBus
                        </h1>
                        <p className="mt-1 max-w-xl text-sm text-body">
                            Interactive view of a lock-free SPSC event bus — powered by the real
                            C++20 headers compiled to WebAssembly.
                        </p>
                    </div>
                    <DialogPrimitive.Root>
                        <DialogPrimitive.Trigger className="inline-flex items-center gap-1.5 border border-rule-strong px-2.5 py-1.5 font-mono text-xs text-body hover:bg-rule">
                            <Info size={14} /> about
                        </DialogPrimitive.Trigger>
                        <DialogPrimitive.Portal>
                            <DialogPrimitive.Overlay className="fixed inset-0 bg-ink/20" />
                            <DialogPrimitive.Content className="fixed left-1/2 top-1/2 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 border border-rule-strong bg-parchment p-5 shadow-xl">
                                <DialogPrimitive.Title className="heading-ink text-base">
                                    What is being simulated
                                </DialogPrimitive.Title>
                                <DialogPrimitive.Description className="mt-2 text-sm leading-relaxed text-body">
                                    The ring buffer and event bus run the actual
                                    zenith::SPSCQueue / zenith::EventBus C++ code compiled to
                                    WASM — indices, cached peer indices, and slot contents are
                                    read straight from the live objects. The cache-line view is
                                    a simplified two-core MESI model (hardware state is not
                                    observable from a browser); assembly shown is real clang
                                    -O2 output for x86-64.
                                </DialogPrimitive.Description>
                            </DialogPrimitive.Content>
                        </DialogPrimitive.Portal>
                    </DialogPrimitive.Root>
                </header>

                {!ready ? (
                    <Panel className="p-8 text-center font-mono text-sm text-caption">
                        loading zenith wasm module…
                    </Panel>
                ) : (
                    <TabsPrimitive.Root defaultValue="ring">
                        <TabsPrimitive.List className="mb-4 flex gap-px border border-rule-strong bg-rule-strong">
                            {TABS.map((t) => (
                                <TabsPrimitive.Trigger
                                    key={t.id}
                                    value={t.id}
                                    className={cn(
                                        'px-4 py-2 font-mono text-xs uppercase tracking-wider text-body transition-colors',
                                        'bg-surface hover:bg-parchment data-[state=active]:bg-parchment data-[state=active]:text-ink',
                                        'data-[state=active]:shadow-[inset_0_2px_0_#4338CA]',
                                    )}
                                >
                                    {t.label}
                                </TabsPrimitive.Trigger>
                            ))}
                        </TabsPrimitive.List>
                        <TabsPrimitive.Content value="ring"><RingBufferPlayground /></TabsPrimitive.Content>
                        <TabsPrimitive.Content value="cache"><CacheInspector /></TabsPrimitive.Content>
                        <TabsPrimitive.Content value="bus"><EventBusPipeline /></TabsPrimitive.Content>
                        <TabsPrimitive.Content value="asm"><MemoryOrdering /></TabsPrimitive.Content>
                    </TabsPrimitive.Root>
                )}

                <footer className="mt-auto pt-6 text-center font-mono text-[10px] text-caption">
                    zenith-bus — header-only C++20 SPSC event bus · wasm bindings: wasm/zenith_api.cpp
                </footer>
            </div>
        </TooltipPrimitive.Provider>
    );
}
