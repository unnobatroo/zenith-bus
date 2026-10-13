import Prism from 'prismjs';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-nasm';

import { cn } from '../lib/utils';

/**
 * Minimal Prism wrapper — plain <pre> output, no line numbers machinery.
 * `highlight` marks 0-based line indexes that carry the semantics being
 * explained (e.g. the release store).
 */
export function CodeBlock({
    code,
    lang,
    highlight = [],
    className,
}: {
    code: string;
    lang: 'cpp' | 'nasm';
    highlight?: number[];
    className?: string;
}) {
    const html = Prism.highlight(code, Prism.languages[lang] ?? Prism.languages.plain, lang);
    const lines = html.split('\n');
    return (
        <pre
            className={cn(
                'overflow-x-auto border border-rule bg-parchment p-3 font-mono text-[11px] leading-relaxed text-body',
                className,
            )}
        >
            {lines.map((line, i) => (
                <div
                    key={i}
                    className={cn(
                        'px-1',
                        highlight.includes(i) && '-mx-3 border-l-2 border-barrier bg-barrier/10 px-[13px]',
                    )}
                    dangerouslySetInnerHTML={{ __html: line || ' ' }}
                />
            ))}
        </pre>
    );
}
