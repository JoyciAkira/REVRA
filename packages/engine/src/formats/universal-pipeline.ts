/**
 * UniversalAnalysisPipeline (PRD §3.1 + visione copertura universale):
 * binario in ingresso → detection dai magic bytes → routing all'engine
 * disponibile → analisi → AnalysisResult nel kernel con provenance engine.
 * Nessun passo silenzioso: detection, routing e capability sono nel report.
 */
import type {
  Actor,
  AnalysisResult,
  FormatDetection,
  RoutingDecision,
} from '@revra/contracts';
import { EvidenceKernel } from '@revra/kernel';
import { detectFormat } from './format-detector.js';
import { FormatEngineRegistry } from './engine-registry.js';
import type { FormatEngineAdapter } from './adapters.js';

export interface UniversalAnalysisReport {
  detection: FormatDetection | null;
  routing: RoutingDecision;
  result?: AnalysisResult;
  reason?: string;
}

export class UniversalAnalysisPipeline {
  constructor(
    private readonly deps: { kernel: EvidenceKernel; registry: FormatEngineRegistry },
  ) {}

  async analyze(input: {
    bytes: Uint8Array;
    binaryHash: string;
  }): Promise<UniversalAnalysisReport> {
    const detection = detectFormat(input.bytes);
    const routing = await this.deps.registry.route(detection);

    if (routing.status !== 'SUPPORTED' || !detection) {
      return { detection, routing, reason: routing.reason };
    }

    const adapter: FormatEngineAdapter | null = await this.deps.registry.resolveAvailable(detection);
    if (!adapter) {
      return { detection, routing, reason: 'engine non più disponibile al momento dell\'analisi' };
    }

    const addressRange = {
      start: '0x0',
      end: `0x${input.bytes.length.toString(16)}`,
    };
    const actor: Actor = { kind: 'engine', id: adapter.engineId };
    const output = await adapter.analyze({
      bytes: input.bytes,
      binaryHash: input.binaryHash,
      addressRange,
      detection: { ecosystem: detection.ecosystem, format: detection.format },
    });

    // Engine actor su claim di analisi → L1 (il kernel impone la gerarchia).
    const result = this.deps.kernel.submit(
      {
        binaryHash: input.binaryHash,
        arch: detection.ecosystem,
        addressRange,
        engineSource: `${adapter.engineId}@${adapter.engineVersion}`,
        claim: output.claim,
      },
      actor,
    );
    const resultWithWarnings: AnalysisResult = {
      ...result,
      verification: {
        ...result.verification,
        warnings: [...result.verification.warnings, ...output.warnings],
      },
    };

    return { detection, routing, result: resultWithWarnings };
  }
}
