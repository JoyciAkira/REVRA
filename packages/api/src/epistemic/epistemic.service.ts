/**
 * Epistemic facade (PRD §3.3): pattern corpus, generazione autonoma di
 * ipotesi, verdetto (meta-learning), causal reasoning differenziale, metrics.
 */
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Hypothesis } from '@revra/contracts';
import type { EpistemicMetrics } from '@revra/engine';
import { EpistemicEngine } from '@revra/engine';
import { EPISTEMIC_ENGINE } from './tokens.js';

const patternBodySchema = z.object({
  arch: z.string().min(1),
  firstEngineSource: z.string().min(1),
  family: z.string().min(1),
});

const generateBodySchema = z.object({
  binaryHash: z.string().min(8),
  arch: z.string().min(1),
  firstEngineSource: z.string().min(1),
});

const verdictBodySchema = z.object({
  verdict: z.enum(['CONFIRMED', 'FALSIFIED']),
});

const observationBodySchema = z.object({
  cause: z.string().min(1),
  effect: z.string().min(1),
  method: z.enum(['differential', 'co-occurrence']),
});

@Injectable()
export class EpistemicService {
  @Inject(EPISTEMIC_ENGINE)
  private readonly engine!: EpistemicEngine;

  learnPattern(body: unknown): { patternId: string } {
    const { arch, firstEngineSource, family } = patternBodySchema.parse(body);
    const pattern = this.engine.learnPattern(arch, firstEngineSource, family, new Date().toISOString());
    return { patternId: pattern.patternId };
  }

  generate(body: unknown): Hypothesis[] {
    const input = generateBodySchema.parse(body);
    return this.engine.generate(input, new Date().toISOString());
  }

  applyVerdict(hypothesisId: string, body: unknown): Hypothesis {
    const { verdict } = verdictBodySchema.parse(body);
    return this.engine.applyVerdict(hypothesisId, verdict);
  }

  listHypotheses(): Hypothesis[] {
    return this.engine.listHypotheses();
  }

  observe(body: unknown): { recorded: true } {
    const { cause, effect, method } = observationBodySchema.parse(body);
    this.engine.recordObservation(cause, effect, method, new Date().toISOString());
    return { recorded: true };
  }

  relation(cause: string, effect: string): { relation: string; observations?: number } {
    return this.engine.relationBetween(cause, effect);
  }

  counterfactual(cause: string, effect: string): { text: string } {
    return { text: this.engine.counterfactual(cause, effect) };
  }

  metrics(): EpistemicMetrics {
    return this.engine.metrics();
  }
}
