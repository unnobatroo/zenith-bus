import type { BufferSlotState } from '../core/types';
import { cn } from '../lib/utils';

/** Circular slot wheel: cobalt tail arrow outside, teal head arrow inside. */
export function RingWheel({
    slots,
    capacity,
    depth,
    headSlot,
    tailSlot,
}: {
    slots: BufferSlotState<number>[];
    capacity: number;
    depth: number;
    headSlot: number;
    tailSlot: number;
}) {
    const cx = 130;
    const cy = 130;
    const slotRadius = 84;
    const r = capacity <= 8 ? 15 : capacity <= 16 ? 11 : 7.5;
    const pos = (i: number, radius: number) => {
        const a = (i / capacity) * 2 * Math.PI - Math.PI / 2;
        return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a), angle: a };
    };
    const marker = (i: number, radius: number, color: string, label: string) => {
        const p = pos(i, radius);
        const deg = (p.angle * 180) / Math.PI + 90;
        return (
            <g transform={`translate(${p.x},${p.y}) rotate(${deg})`}>
                <polygon points="0,-7 6,6 -6,6" fill={color} />
                <text
                    y={18}
                    textAnchor="middle"
                    transform={`rotate(${-deg})`}
                    className="fill-body font-mono text-[9px] font-semibold"
                >
                    {label}
                </text>
            </g>
        );
    };
    return (
        <svg viewBox="0 0 260 260" className="w-full max-w-[420px]">
            <circle cx={cx} cy={cy} r={slotRadius} fill="none" stroke="#E5E5DF" strokeDasharray="2 3" />
            {slots.map((s) => {
                const p = pos(s.index, slotRadius);
                return (
                    <g key={s.index}>
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r={r}
                            className={cn(
                                'transition-colors duration-150',
                                s.occupied ? 'fill-rule-strong stroke-ink' : 'fill-parchment stroke-rule-strong',
                            )}
                            strokeWidth={1}
                        />
                        <text
                            x={p.x}
                            y={p.y + 3}
                            textAnchor="middle"
                            className={cn(
                                'fill-ink font-mono',
                                capacity > 16 ? 'text-[7px]' : 'text-[10px]',
                                !s.occupied && 'fill-caption',
                            )}
                        >
                            {s.occupied ? String(s.value) : s.index}
                        </text>
                        <title>
                            slot {s.index} — {s.occupied ? `value ${s.value}` : 'free'}
                        </title>
                    </g>
                );
            })}
            {depth < capacity && marker(tailSlot, 112, '#2563EB', 'tail_')}
            {depth > 0 && marker(headSlot, 52, '#0F766E', 'head_')}
            <text x={cx} y={cy - 4} textAnchor="middle" className="fill-ink font-mono text-xl">
                {depth}
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" className="fill-caption font-mono text-[9px] uppercase tracking-widest">
                of {capacity}
            </text>
        </svg>
    );
}
