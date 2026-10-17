/**
 * Universal coverage facade (PRD §3.1 + visione founder): detection dai
 * magic bytes, routing con capability dichiarate, analisi nel kernel,
 * coverage matrix live generata dai probe di disponibilità.
 */
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { CoverageMatrix, RoutingDecision } from '@revra/contracts';
import type { UniversalAnalysisReport } from '@revra/engine';
import { detectFormat, FormatEngineRegistry, UniversalAnalysisPipeline } from '@revra/engine';
import { EVIDENCE_KERNEL } from '../tokens.js';
import { FORMAT_ENGINE_REGISTRY, UNIVERSAL_PIPELINE } from './tokens.js';

const routeBodySchema = z.object({
  binary: z.string().min(4),
});

const analyzeBodySchema = z.object({
  binary: z.string().min(4),
  binaryHash: z.string().min(8),
});

@Injectable()
export class FormatsService {
  @Inject(FORMAT_ENGINE_REGISTRY)
  private readonly registry!: FormatEngineRegistry;

  @Inject(UNIVERSAL_PIPELINE)
  private readonly pipeline!: UniversalAnalysisPipeline;

  route(body: unknown): Promise<RoutingDecision> {
    const { binary } = routeBodySchema.parse(body);
    const bytes = Uint8Array.from(Buffer.from(binary, 'base64'));
    return this.registry.route(detectFormat(bytes));
  }

  analyze(body: unknown): Promise<UniversalAnalysisReport> {
    const { binary, binaryHash } = analyzeBodySchema.parse(body);
    const bytes = Uint8Array.from(Buffer.from(binary, 'base64'));
    return this.pipeline.analyze({ bytes, binaryHash });
  }

  matrix(): Promise<CoverageMatrix> {
    return this.registry.coverageMatrix(new Date().toISOString());
  }
}
