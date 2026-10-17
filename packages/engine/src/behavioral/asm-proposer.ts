/**
 * AsmBehavioralProposer (M2): propone candidati behavioral-testable — bytes
 * x86-64 + output atteso (EAX). È il proposer che permette al behavioral
 * testing di fare re-execution reale con Unicorn.
 */
import type {
  DecompileContext,
  DecompilationCandidate,
  NeuralProposer,
} from '../hybrid/types.js';

export interface AsmCase {
  /** Codice macchina x86-64 in hex (termina per convenzione con c3 = RET). */
  asmBytesHex: string;
  /** Output atteso della funzione (EAX al RET). */
  expectedRax: number;
}

export class AsmBehavioralProposer implements NeuralProposer {
  readonly modelId = 'asm-behavioral-proposer';
  readonly modelVersion = '0.1.0';
  private seq = 0;

  constructor(private readonly cases: AsmCase[]) {}

  async propose(_ctx: DecompileContext): Promise<DecompilationCandidate[]> {
    this.seq += 1;
    return this.cases.map((c, i) => ({
      claim: { kind: 'behavioral-case', payload: { ...c } },
      confidence: Number((0.95 - i * 0.1).toFixed(2)),
      modelId: this.modelId,
      modelVersion: this.modelVersion,
    }));
  }
}
