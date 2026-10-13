import { ArrowDownToLine, ArrowUpFromLine, RotateCcw } from 'lucide-react';

import { MemoryLog } from '../components/MemoryLog';
import { RingWheel } from '../components/RingWheel';
import { Panel, PanelTitle, Stat, TechButton, TechSlider, TechSwitch } from '../components/primitives';
import { useSimulationStore } from '../store/useSimulationStore';
import { cn } from '../lib/utils';

const CAPACITIES = [8, 16, 32];

export function RingBufferPlayground() {
    const s = useSimulationStore();
    const full = s.ringDepth === s.ringCapacity;
    const empty = s.ringDepth === 0;

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Panel className="flex flex-col items-center">
                <div className="flex w-full items-center justify-between">
                    <PanelTitle>Ring Buffer — storage_[]</PanelTitle>
                    <div className="flex gap-1">
                        {CAPACITIES.map((c) => (
                            <TechButton
                                key={c}
                                variant={c === s.ringCapacity ? 'producer' : 'ghost'}
                                className="px-2 py-0.5"
                                onClick={() => s.setRingCapacity(c)}
                            >
                                {c}
                            </TechButton>
                        ))}
                    </div>
                </div>
                <RingWheel
                    slots={s.slots}
                    capacity={s.ringCapacity}
                    depth={s.ringDepth}
                    headSlot={s.headSlot}
                    tailSlot={s.tailSlot}
                />
                <div
                    className={cn(
                        'mt-2 w-full border px-3 py-1.5 text-center font-mono text-xs',
                        full && 'border-warn bg-warn/10 text-warn',
                        empty && 'border-rule-strong bg-parchment text-caption',
                        !full && !empty && 'border-rule bg-parchment text-body',
                    )}
                >
                    {full
                        ? 'BUFFER FULL — try_push returns false'
                        : empty
                          ? 'BUFFER EMPTY — try_pop returns false'
                          : `${s.ringDepth} item(s) in flight`}
                </div>
                <div className="mt-3 grid w-full grid-cols-3 gap-3">
                    <Stat label="head_ (consumer)" value={s.head} accent="#0F766E" />
                    <Stat label="tail_ (producer)" value={s.tail} accent="#2563EB" />
                    <Stat label="last popped" value={s.lastPopped ?? '—'} />
                </div>
            </Panel>

            <div className="flex flex-col gap-4">
                <Panel>
                    <PanelTitle>Controls</PanelTitle>
                    <div className="flex flex-wrap gap-2">
                        <TechButton variant="producer" onClick={s.pushItem} disabled={full}>
                            <ArrowDownToLine size={14} /> Push item
                        </TechButton>
                        <TechButton variant="consumer" onClick={s.popItem} disabled={empty}>
                            <ArrowUpFromLine size={14} /> Pop item
                        </TechButton>
                        <TechButton onClick={s.resetRing}>
                            <RotateCcw size={14} /> Reset
                        </TechButton>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2 border border-rule bg-parchment p-3">
                            <TechSwitch
                                label="Auto producer"
                                checked={s.autoProducer}
                                onCheckedChange={s.toggleAutoProducer}
                            />
                            <TechSlider
                                label="rate"
                                value={s.producerHz}
                                min={0.5}
                                max={20}
                                step={0.5}
                                onChange={s.setProducerHz}
                                format={(v) => `${v}/s`}
                            />
                        </div>
                        <div className="flex flex-col gap-2 border border-rule bg-parchment p-3">
                            <TechSwitch
                                label="Auto consumer"
                                checked={s.autoConsumer}
                                onCheckedChange={s.toggleAutoConsumer}
                            />
                            <TechSlider
                                label="rate"
                                value={s.consumerHz}
                                min={0.5}
                                max={20}
                                step={0.5}
                                onChange={s.setConsumerHz}
                                format={(v) => `${v}/s`}
                            />
                        </div>
                    </div>
                </Panel>

                <Panel>
                    <PanelTitle>Memory operation trace — newest first</PanelTitle>
                    <MemoryLog steps={s.memLog} />
                </Panel>
            </div>
        </div>
    );
}
