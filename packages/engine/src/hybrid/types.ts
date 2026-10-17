/**
 * Neural-Symbolic Hybrid seam (PRD §3.1): the neural model proposes
 * decompilation candidates; the symbolic verifier confirms or refutes each
 * one with proof. The kernel (G1) remains the sole authority on evidence
 * levels — this package only orchestrates and measures.
 */
import type { Actor, AddressRange, Claim } from '@revra/contracts';

export interface DecompileContext {
  binaryHash: string;
  arch: string;
  addressRange: AddressRange;
}

export interface DecompilationCandidate {
  claim: Claim;
  /** Calibrated model confidence in [0,1]. */
  confidence: number;
  modelId: string;
  modelVersion: string;
}

export interface NeuralProposer {
  readonly modelId: string;
  readonly modelVersion: string;
  propose(ctx: DecompileContext): Promise<DecompilationCandidate[]>;
}

export type CandidateVerdictOutcome = 'VERIFIED' | 'REFUTED' | 'INCONCLUSIVE';

export interface CandidateVerdict {
  outcome: CandidateVerdictOutcome;
  /** Proof/test reference that justifies the verdict — required for VERIFIED/REFUTED. */
  evidenceRef?: string;
  reason?: string;
}

export interface SymbolicVerifier {
  readonly verifierId: string;
  readonly version: string;
  verify(candidate: DecompilationCandidate, ctx: DecompileContext): Promise<CandidateVerdict>;
}

export type CandidateOutcome = 'VERIFIED_PROMOTED' | 'REFUTED' | 'INCONCLUSIVE';

export interface HybridCandidateReport {
  resultId: string;
  confidence: number;
  outcome: CandidateOutcome;
  evidenceRef?: string;
  reason?: string;
}

export interface HybridRunReport {
  runId: string;
  ctx: DecompileContext;
  candidates: HybridCandidateReport[];
  durationMs: number;
}

/** Actor the kernel sees for neural submissions (AI Authority Boundary applies). */
export function neuralActor(proposer: NeuralProposer): Actor {
  return { kind: 'ai', id: proposer.modelId };
}

/** Actor the kernel sees for symbolic verdicts. */
export function symbolicActor(verifier: SymbolicVerifier): Actor {
  return { kind: 'symbolic', id: verifier.verifierId };
}
