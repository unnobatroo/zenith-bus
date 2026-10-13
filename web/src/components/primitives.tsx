import * as SliderPrimitive from '@radix-ui/react-slider';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

import { cn } from '../lib/utils';

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cn('panel p-4', className)}>{children}</div>;
}

export function PanelTitle({ children }: { children: ReactNode }) {
    return <h3 className="label-tech mb-3">{children}</h3>;
}

export function Stat({
    label,
    value,
    unit,
    accent,
}: {
    label: string;
    value: string | number;
    unit?: string;
    accent?: string;
}) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="label-tech">{label}</span>
            <span className="font-mono text-lg leading-none text-ink" style={accent ? { color: accent } : undefined}>
                {value}
                {unit && <span className="ml-1 text-xs text-caption">{unit}</span>}
            </span>
        </div>
    );
}

export function TechButton({
    className,
    variant = 'default',
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'producer' | 'consumer' | 'ghost' }) {
    return (
        <button
            className={cn(
                'inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-mono text-xs transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-40',
                variant === 'default' && 'border-rule-strong bg-parchment text-ink hover:bg-rule',
                variant === 'producer' && 'border-producer-deep bg-producer text-white hover:bg-producer-deep',
                variant === 'consumer' && 'border-consumer bg-consumer text-white hover:bg-consumer/90',
                variant === 'ghost' && 'border-transparent text-body hover:bg-rule',
                className,
            )}
            {...props}
        />
    );
}

export function TechSlider({
    label,
    value,
    min,
    max,
    step = 1,
    onChange,
    format,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (v: number) => void;
    format?: (v: number) => string;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
                <span className="label-tech">{label}</span>
                <span className="font-mono text-xs text-ink">{format ? format(value) : value}</span>
            </div>
            <SliderPrimitive.Root
                className="relative flex h-4 w-full touch-none select-none items-center"
                value={[value]}
                min={min}
                max={max}
                step={step}
                onValueChange={([v]) => onChange(v)}
            >
                <SliderPrimitive.Track className="relative h-px w-full grow bg-rule-strong">
                    <SliderPrimitive.Range className="absolute h-full bg-ink" />
                </SliderPrimitive.Track>
                <SliderPrimitive.Thumb className="block h-3 w-3 cursor-pointer rounded-none border border-ink bg-parchment shadow-sm focus:outline-none focus:ring-1 focus:ring-ink" />
            </SliderPrimitive.Root>
        </div>
    );
}

export function TechSwitch({
    label,
    checked,
    onCheckedChange,
}: {
    label: string;
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-2">
            <SwitchPrimitive.Root
                checked={checked}
                onCheckedChange={onCheckedChange}
                className={cn(
                    'relative h-4 w-8 rounded-full border border-rule-strong transition-colors',
                    checked ? 'bg-ink' : 'bg-rule',
                )}
            >
                <SwitchPrimitive.Thumb
                    className={cn(
                        'block h-3 w-3 translate-x-0.5 rounded-full bg-parchment shadow transition-transform',
                        checked && 'translate-x-[18px]',
                    )}
                />
            </SwitchPrimitive.Root>
            <span className="label-tech">{label}</span>
        </label>
    );
}

export function Hint({ content, children }: { content: string; children: ReactNode }) {
    return (
        <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                    className="max-w-xs rounded-sm border border-rule-strong bg-ink px-2.5 py-1.5 font-mono text-[11px] leading-snug text-parchment"
                    sideOffset={5}
                >
                    {content}
                    <TooltipPrimitive.Arrow className="fill-ink" />
                </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
    );
}
