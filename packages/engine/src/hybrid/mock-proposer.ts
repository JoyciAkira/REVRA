/**
 * Deterministic stand-in for the transformer proposer (PRD §9): produces a
 * well-formed candidate first, then progressively malformed ones so the
 * refutation path of the hybrid pipeline is exercised end-to-end. The real
 * model plugs into the same NeuralProposer seam.
 */
import type {
  DecompileContext,
  DecompilationCandidate,
  NeuralProposer,
} from './types.js';

export class MockNeuralProposer implements NeuralProposer {
  readonly modelId = 'mock-transformer';
  readonly modelVersion = '0.1.0';
  private seq = 0;

  constructor(private readonly candidatesPerRun = 3) {}

  async propose(ctx: DecompileContext): Promise<DecompilationCandidate[]> {
    const base = Number.parseInt(ctx.addressRange.start, 16) + ++this.seq;
    const shape = (body: string): string => `int f() {${body}}`;
    const variants = [
      shape(` return ${base}; `), // well-formed → verified
      `int f() { return ${base}; `, // unbalanced braces → refuted
      '', // empty payload → refuted
      shape(` call_${base}(); `), // well-formed alternative
    ];
    return variants.slice(0, Math.max(0, this.candidatesPerRun)).map((pseudocode, i) => ({
      claim: { kind: 'decompilation', payload: { pseudocode } },
      confidence: Number((0.95 - i * 0.15).toFixed(2)),
      modelId: this.modelId,
      modelVersion: this.modelVersion,
    }));
  }
}
