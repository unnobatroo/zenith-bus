import { useEffect, useRef } from 'react';

/** Lightweight rolling bar chart of packets/sec — direct 2D canvas. */
export function ThroughputChart({ history, color = '#2563EB' }: { history: number[]; color?: string }) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const max = Math.max(...history, 1);
        const bw = Math.max(2, w / 60);
        history.forEach((v, i) => {
            const bh = (v / max) * (h - 4);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(w - (history.length - i) * bw, h - bh, bw - 1, bh);
        });
        // baseline rule
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#D4D4CD';
        ctx.beginPath();
        ctx.moveTo(0, h - 0.5);
        ctx.lineTo(w, h - 0.5);
        ctx.stroke();
    }, [history, color]);

    return <canvas ref={ref} className="h-16 w-full" />;
}
