/**
 * A3 — Observability controller: espone le metriche in formato Prometheus
 * text exposition (/metrics) e il report SLO settimanale in markdown (/slo).
 * Zero dipendenze esterne; legge dal MetricsRegistry condiviso.
 */
import { Controller, Get, Header, Inject } from '@nestjs/common';
import {
  MetricsRegistry,
  buildSloReport,
  renderSloReportMarkdown,
} from './metrics.js';
import { METRICS_REGISTRY } from './tokens.js';

@Controller()
export class ObservabilityController {
  constructor(@Inject(METRICS_REGISTRY) private readonly registry: MetricsRegistry) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string {
    return this.registry.renderPrometheus();
  }

  @Get('slo')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  slo(): string {
    const entries = buildSloReport(this.registry);
    return renderSloReportMarkdown(entries);
  }

  /** JSON machine-readable SLO report (per alerting/automation). */
  @Get('slo/json')
  sloJson(): ReturnType<typeof buildSloReport> {
    return buildSloReport(this.registry);
  }
}