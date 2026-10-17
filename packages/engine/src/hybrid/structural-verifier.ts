/**
 * Deterministic symbolic verifier: structural rules over the candidate
 * pseudocode (well-formedness, balanced braces). Honest scope: this is the
 * structural-validation stage of the PRD pipeline (Neural Proposal →
 * Structural Validation → Behavioral Testing → Formal Proof); behavioral
 * testing on emulated execution lands with the engine containers.
 */
import { createHash } from 'node:crypto';
import type {
  CandidateVerdict,
  DecompileContext,
  DecompilationCandidate,
  SymbolicVerifier,
} from './types.js';

export class StructuralRuleVerifier implements SymbolicVerifier {
  readonly verifierId = 'structural-rules';
  readonly version = '0.1.0';

  async verify(
    candidate: DecompilationCandidate,
    _ctx: DecompileContext,
  ): Promise<CandidateVerdict> {
    const payload = candidate.claim.payload as { pseudocode?: unknown } | null;
    const pseudocode = typeof payload?.pseudocode === 'string' ? payload.pseudocode : undefined;

    if (pseudocode === undefined) {
      return this.refuted(candidate, 'rule=payload-shape', 'claim payload carries no pseudocode');
    }
    if (pseudocode.trim().length === 0) {
      return this.refuted(candidate, 'rule=non-empty', 'pseudocode is empty');
    }
    const braces = pseudocode.split('').filter((c) => c === '{' || c === '}');
    const balance = braces.reduce((acc, c) => acc + (c === '{' ? 1 : -1), 0);
    if (balance !== 0) {
      return this.refuted(candidate, 'rule=balanced-blocks', `brace balance is ${balance}`);
    }
    return {
      outcome: 'VERIFIED',
      evidenceRef: this.evidenceRef(candidate, 'all-rules'),
    };
  }

  private refuted(candidate: DecompilationCandidate, rule: string, reason: string): CandidateVerdict {
    return {
      outcome: 'REFUTED',
      evidenceRef: this.evidenceRef(candidate, rule),
      reason,
    };
  }

  private evidenceRef(candidate: DecompilationCandidate, rule: string): string {
    const hash = createHash('sha256').update(JSON.stringify(candidate.claim)).digest('hex');
    return `structural://${this.verifierId}@${this.version}/${rule}/${hash.slice(0, 12)}`;
  }
}
