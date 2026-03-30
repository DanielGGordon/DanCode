import { performance } from 'node:perf_hooks';

/**
 * Run a function N times and collect timing statistics.
 */
export async function bench(fn, { iterations = 50, warmup = 3 } = {}) {
  for (let i = 0; i < warmup; i++) await fn();

  const timings = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    timings.push(performance.now() - start);
  }

  timings.sort((a, b) => a - b);
  const sum = timings.reduce((a, b) => a + b, 0);

  return {
    iterations,
    min: timings[0],
    max: timings[timings.length - 1],
    mean: sum / timings.length,
    p50: percentile(timings, 50),
    p95: percentile(timings, 95),
    p99: percentile(timings, 99),
    rps: Math.round(1000 / (sum / timings.length)),
  };
}

function percentile(sorted, p) {
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

export function formatMs(ms) {
  if (ms < 0.1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Print a latency benchmark table.
 */
export function printTable(title, results) {
  console.log(`\n${'═'.repeat(94)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(94)}`);

  const header = ['Benchmark', 'Iter', 'Min', 'Mean', 'P50', 'P95', 'P99', 'Max', 'req/s'];
  const rows = results.map(r => [
    r.name,
    String(r.iterations),
    formatMs(r.min),
    formatMs(r.mean),
    formatMs(r.p50),
    formatMs(r.p95),
    formatMs(r.p99),
    formatMs(r.max),
    String(r.rps),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length))
  );

  const sep = '─';
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  const fmtRow = (row) => row.map((cell, i) => ` ${pad(cell, widths[i])} `).join('│');

  console.log('┌' + widths.map(w => sep.repeat(w + 2)).join('┬') + '┐');
  console.log('│' + fmtRow(header) + '│');
  console.log('├' + widths.map(w => sep.repeat(w + 2)).join('┼') + '┤');
  rows.forEach(row => console.log('│' + fmtRow(row) + '│'));
  console.log('└' + widths.map(w => sep.repeat(w + 2)).join('┴') + '┘');
}

/**
 * Print a simple key/value section.
 */
export function printKV(title, entries) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);

  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
  entries.forEach(([key, value]) => {
    console.log(`  ${key.padEnd(maxKeyLen)}  ${value}`);
  });
}
