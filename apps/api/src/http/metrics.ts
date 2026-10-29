import * as R from 'remeda';

/** Counters and gauges in the Prometheus text format, in a few lines. */
export const createMetrics = () => {
    const counters = new Map<string, number>();
    const label = (labels: Readonly<Record<string, string>>): string => {
        const text = R.pipe(
            labels,
            R.entries(),
            R.map(
                ([key, value]) =>
                    `${key}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`
            ),
            R.join(',')
        );
        return text === '' ? '' : `{${text}}`;
    };

    return {
        increment(name: string, labels: Readonly<Record<string, string>> = {}): void {
            const key = `${name}${label(labels)}`;
            counters.set(key, (counters.get(key) ?? 0) + 1);
        },
        /** `gauges` are read at render time; counters accumulate. */
        render(gauges: Readonly<Record<string, number | undefined>>): string {
            const lines: string[] = [];
            for (const [name, value] of R.entries(gauges)) {
                if (value === undefined) continue;
                lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
            }
            const typed = new Set<string>();
            for (const [key, value] of [...counters].sort(([a], [b]) => a.localeCompare(b))) {
                const name = key.split('{')[0] ?? key;
                if (!typed.has(name)) {
                    typed.add(name);
                    lines.push(`# TYPE ${name} counter`);
                }
                lines.push(`${key} ${value}`);
            }
            return `${lines.join('\n')}\n`;
        },
    };
};

export type Metrics = ReturnType<typeof createMetrics>;
