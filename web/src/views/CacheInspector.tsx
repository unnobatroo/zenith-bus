import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';

import { Panel, PanelTitle, Stat, TechButton, TechSwitch } from '../components/primitives';
import type { LineSnapshot } from '../core/CacheLineSimulator';
import { useSimulationStore } from '../store/useSimulationStore';
import { cn } from '../lib/utils';

const MESI_COLOR: Record<string, string> = {
    M: 'bg-warn/15 text-warn border-warn/40',
    E: 'bg-producer/10 text-producer-deep border-producer/40',
    S: 'bg-consumer/10 text-consumer border-consumer/40',
    I: 'bg-rule text-caption border-rule-strong',
};

function ByteGrid({ line, padded }: { line: LineSnapshot; padded: boolean }) {
    // Mark which bytes hold head_/tail_ in each layout.
    const varRanges: { start: number; end: number; label: string; color: string }[] = [];
    if (!padded && line.id === 0) {
        varRanges.push(
            { start: 0, end: 8, label: 'head_', color: '#0F766E' },
            { start: 8, end: 16, label: 'tail_', color: '#2563EB' },
        );
    } else if (padded && line.id === 0) {
        varRanges.push({ start: 0, end: 8, label: 'head_', color: '#0F766E' });
    } else if (padded && line.id === 1) {
        varRanges.push(
            { start: 0, end: 8, label: 'tail_', color: '#2563EB' },
            { start: 8, end: 16, label: 'cached_head_', color: '#4338CA' },
        );
    }
    const byteColor = (b: number) =>
        varRanges.find((r) => b >= r.start && b < r.end)?.color;
    return (
        <div>
            <div className="mb-1 flex items-center justify-between">
                <span className="label-tech">line {line.id} — {line.addressRange}</span>
                <span className="flex gap-1 font-mono text-[9px]">
                    <span className={cn('border px-1', MESI_COLOR[line.core0])}>C0:{line.core0}</span>
                    <span className={cn('border px-1', MESI_COLOR[line.core1])}>C1:{line.core1}</span>
                </span>
            </div>
            <motion.div
                animate={
                    line.flash > 0
                        ? { boxShadow: ['0 0 0 0 rgba(180,83,9,0)', '0 0 0 3px rgba(180,83,9,0.55)', '0 0 0 0 rgba(180,83,9,0)'] }
                        : {}
                }
                transition={{ duration: 0.35, repeat: line.flash > 0 ? Infinity : 0 }}
                className="grid grid-cols-[repeat(32,minmax(0,1fr))] border border-rule-strong bg-parchment"
            >
                {Array.from({ length: 64 }, (_, b) => (
                    <div
                        key={b}
                        style={{
                            backgroundColor: byteColor(b) ? `${byteColor(b)}26` : undefined,
                            borderTop: `2px solid ${byteColor(b) ?? 'transparent'}`,
                        }}
                        className="h-3 border-r border-rule last:border-r-0 odd:bg-surface/60"
                    />
                ))}
            </motion.div>
            <div className="mt-1 flex gap-3">
                {varRanges.map((r) => (
                    <span key={r.label} className="flex items-center gap-1 font-mono text-[10px]" style={{ color: r.color }}>
                        <span className="inline-block h-2 w-2" style={{ backgroundColor: `${r.color}40`, borderTop: `2px solid ${r.color}` }} />
                        {r.label}
                    </span>
                ))}
                {line.vars.length === 0 && <span className="font-mono text-[10px] text-caption">unused</span>}
            </div>
        </div>
    );
}

export function CacheInspector() {
    const s = useSimulationStore();
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Panel>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <PanelTitle>L1 data cache — two 64-byte lines</PanelTitle>
                    <TechSwitch
                        label="alignas(64) padding"
                        checked={s.padded}
                        onCheckedChange={s.togglePadding}
                    />
                </div>
                <p className="mb-4 text-xs leading-relaxed text-body">
                    {s.padded
                        ? 'head_ and tail_ live on separate cache lines. Core 0 writes tail_ (line 1), Core 1 writes head_ (line 0) — neither invalidates the other.'
                        : 'head_ and tail_ share line 0. Every write by one core invalidates the other core\u2019s copy — the line ping-pongs between L1s.'}
                </p>
                <div className="flex flex-col gap-4">
                    {s.cacheLines.map((l) => (
                        <ByteGrid key={l.id} line={l} padded={s.padded} />
                    ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <TechButton variant="producer" onClick={s.concurrentStep}>
                        <Zap size={14} /> Concurrent step
                    </TechButton>
                    <TechSwitch label="Auto (10/s)" checked={s.autoCache} onCheckedChange={s.toggleAutoCache} />
                    <TechButton onClick={s.resetCache}>Reset counters</TechButton>
                </div>
            </Panel>

            <div className="flex flex-col gap-4">
                <Panel>
                    <PanelTitle>Invalidation counters</PanelTitle>
                    <div className="grid grid-cols-3 gap-3">
                        <Stat label="invalidations" value={s.invalidations} accent={s.padded ? '#0F766E' : '#B45309'} />
                        <Stat label="line transfers" value={s.transfers} />
                        <Stat label="local hits" value={s.cacheHits} accent="#0F766E" />
                    </div>
                </Panel>
                <Panel>
                    <PanelTitle>Event log — newest first</PanelTitle>
                    <div className="max-h-80 overflow-y-auto border border-rule bg-parchment p-2 font-mono text-[11px] leading-relaxed">
                        {s.cacheEvents.length === 0 && (
                            <div className="px-1 py-2 text-caption">run a concurrent step to generate cache traffic</div>
                        )}
                        {[...s.cacheEvents].reverse().map((e, i) => (
                            <div key={i} className="flex gap-2 px-1">
                                <span
                                    className={cn(
                                        'w-24 shrink-0',
                                        e.kind === 'invalidation' && 'font-semibold text-warn',
                                        e.kind === 'transfer' && 'text-producer-deep',
                                        e.kind === 'hit' && 'text-caption',
                                    )}
                                >
                                    {e.kind}
                                </span>
                                <span className="text-body">{e.detail}</span>
                            </div>
                        ))}
                    </div>
                </Panel>
            </div>
        </div>
    );
}
