import type { MemoryStep } from '../core/types';
import { cn } from '../lib/utils';

const OP_COLOR: Record<MemoryStep['op'], string> = {
    relaxed_load: 'text-body',
    acquire_load: 'text-consumer',
    release_store: 'text-barrier',
    slot_write: 'text-producer',
    slot_read: 'text-consumer',
    cache_reload: 'text-warn',
    rejected: 'text-warn font-semibold',
};

export function MemoryLog({ steps }: { steps: MemoryStep[] }) {
    return (
        <div className="max-h-64 overflow-y-auto border border-rule bg-parchment p-2 font-mono text-[11px] leading-relaxed">
            {steps.length === 0 && <div className="px-1 py-2 text-caption">no operations yet — push or pop an item</div>}
            {steps.map((s, i) => (
                <div key={i} className="flex gap-2 px-1">
                    <span className={cn('w-28 shrink-0', OP_COLOR[s.op])}>{s.op}</span>
                    <span className="text-caption">{s.detail}</span>
                </div>
            ))}
        </div>
    );
}
