/**
 * A3 — Observability & SLO: telemetria leggera zero-dependency.
 * - Histogram in-memory per latenze (sync, analyze, l3_verify) con bucket fissi.
 * - Counter per request totali e per evidence-level distribution.
 * - Esposizione Prometheus text-format su /metrics.
 * - SLO report: p95/p99 calcolati dai bucket + target PRD §11.
 *
 * Design: niente SDK OpenTelemetry esterno (evita bloat monorepo); l'interfaccia
 * è compatibile con il pattern OTel (span name + duration) così una migrazione
 * futura è drop-in. I log strutturati con evidence-id sono emessi dal middleware.
 */

const LATENCY_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

interface HistogramState {
  bucketCounts: number[]; // one per bucket upper-bound +Inf
  sum: number;
  count: number;
}

function emptyHistogram(): HistogramState {
  return { bucketCounts: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0), sum: 0, count: 0 };
}

export class MetricsRegistry {
  private readonly histograms = new Map<string, HistogramState>();
  private readonly counters = new Map<string, number>();

  /** Record a latency observation (ms) for a named histogram. */
  observeLatency(name: string, durationMs: number): void {
    let h = this.histograms.get(name);
    if (!h) {
      h = emptyHistogram();
      this.histograms.set(name, h);
    }
    h.sum += durationMs;
    h.count += 1;
    let placed = false;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      if (durationMs <= LATENCY_BUCKETS_MS[i]!) {
        h.bucketCounts[i]! += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      h.bucketCounts[LATENCY_BUCKETS_MS.length]! += 1; // +Inf bucket
    }
  }

  /** Increment a named counter. */
  incCounter(name: string, by = 1): void {
    this.counter(name, by);
  }

  private counter(name: string, by: number): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  /** Render Prometheus text exposition format. */
  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [name, h] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      let cumulative = 0;
      for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
        cumulative += h.bucketCounts[i]!;
        lines.push(`${name}_bucket{le="${LATENCY_BUCKETS_MS[i]}"} ${cumulative}`);
      }
      cumulative += h.bucketCounts[LATENCY_BUCKETS_MS.length]!;
      lines.push(`${name}_bucket{le="+Inf"} ${cumulative}`);
      lines.push(`${name}_sum ${h.sum}`);
      lines.push(`${name}_count ${h.count}`);
    }
    for (const [name, value] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Estimate a percentile from histogram buckets (linear interpolation within
   * the bucket containing the rank). Returns null when no observations exist.
   */
  percentile(name: string, quantile: number): number | null {
    const h = this.histograms.get(name);
    if (!h || h.count === 0) return null;
    const rank = quantile * h.count;
    let cumulative = 0;
    for (let i = 0; i < h.bucketCounts.length; i++) {
      const prev = cumulative;
      cumulative += h.bucketCounts[i]!;
      if (cumulative >= rank) {
        const upper = i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i]! : LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]! * 2;
        const lower = i > 0 ? LATENCY_BUCKETS_MS[i - 1]! : 0;
        const fraction = h.bucketCounts[i]! > 0 ? (rank - prev) / h.bucketCounts[i]! : 0;
        return lower + (upper - lower) * fraction;
      }
    }
    return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]!;
  }

  count(name: string): number {
    return this.histograms.get(name)?.count ?? 0;
  }

  /** Reset all metrics (test isolation). */
  reset(): void {
    this.histograms.clear();
    this.counters.clear();
  }
}

// Well-known histogram names (PRD §11 SLO targets).
export const METRIC_SYNC_LATENCY = 'revra_sync_latency_ms';
export const METRIC_ANALYZE_DURATION = 'revra_analyze_duration_ms';
export const METRIC_L3_VERIFY_DURATION = 'revra_l3_verify_duration_ms';
export const METRIC_CONSENSUS_LATENCY = 'revra_consensus_latency_ms';
export const COUNTER_REQUESTS_TOTAL = 'revra_requests_total';
export const COUNTER_EVIDENCE_LEVEL = 'revra_evidence_level_total';

// SLO targets from PRD §11 / roadmap A3 gate.
export interface SloTarget {
  metric: string;
  percentile: number;
  targetMs: number;
  label: string;
}

export const SLO_TARGETS: SloTarget[] = [
  { metric: METRIC_SYNC_LATENCY, percentile: 0.95, targetMs: 50, label: 'cross-engine sync <50ms p95' },
  { metric: METRIC_L3_VERIFY_DURATION, percentile: 0.95, targetMs: 60000, label: 'L3 verify <60s p95' },
  { metric: METRIC_CONSENSUS_LATENCY, percentile: 0.99, targetMs: 1, label: 'consensus <1ms p99 (PRD §11 target)' },
];

export interface SloReportEntry {
  label: string;
  metric: string;
  percentile: number;
  targetMs: number;
  observedMs: number | null;
  samples: number;
  met: boolean | null; // null = insufficient data
}

export function buildSloReport(registry: MetricsRegistry): SloReportEntry[] {
  return SLO_TARGETS.map((t) => {
    const observed = registry.percentile(t.metric, t.percentile);
    const samples = registry.count(t.metric);
    return {
      label: t.label,
      metric: t.metric,
      percentile: t.percentile,
      targetMs: t.targetMs,
      observedMs: observed === null ? null : Math.round(observed * 100) / 100,
      samples,
      met: observed === null ? null : observed <= t.targetMs,
    };
  });
}

/** Render a markdown SLO report (weekly auto-report artifact, A3 gate). */
export function renderSloReportMarkdown(entries: SloReportEntry[], generatedAt = new Date().toISOString()): string {
  const lines = [
    `# REVRA SLO Report`,
    `Generated: ${generatedAt}`,
    '',
    '| SLO | Target | Observed | Samples | Status |',
    '|-----|--------|----------|---------|--------|',
  ];
  for (const e of entries) {
    const status = e.met === null ? '⚠️ no data' : e.met ? '✅ met' : '❌ breached';
    const observed = e.observedMs === null ? '—' : `${e.observedMs}ms`;
    lines.push(`| ${e.label} | ${e.targetMs}ms | ${observed} | ${e.samples} | ${status} |`);
  }
  return lines.join('\n') + '\n';
}