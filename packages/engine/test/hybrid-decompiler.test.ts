/**
 * Hybrid pipeline seam (PRD §3.1): neural candidates enter at L1, symbolic
 * verdicts promote or refute with proof, metrics track first-attempt
 * correctness, refutations feed the falsification ledger.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '@revra/kernel';
import { HybridDecompiler } from '../src/hybrid/hybrid-decompiler.js';
import { MockNeuralProposer } from '../src/hybrid/mock-proposer.js';
import { StructuralRuleVerifier } from '../src/hybrid/structural-verifier.js';
import type { CandidateVerdict, DecompileContext, SymbolicVerifier } from '../src/hybrid/types.js';

const CTX: DecompileContext = {
  binaryHash: 'a1b2c3d4e5f60718',
  arch: 'x86_64',
  addressRange: { start: '0x401000', end: '0x4010ff' },
};

class ScriptedVerifier implements SymbolicVerifier {
  readonly verifierId = 'scripted';
  readonly version = '0.0.0';
  constructor(private readonly verdict: CandidateVerdict) {}
  async verify(): Promise<CandidateVerdict> {
    return this.verdict;
  }
}

describe('HybridDecompiler', () => {
  it('promotes the structurally valid candidate to L2 and refutes the malformed ones', async () => {
    const kernel = new EvidenceKernel();
    const hybrid = new HybridDecompiler({
      kernel,
      proposer: new MockNeuralProposer(3),
      verifier: new StructuralRuleVerifier(),
    });

    const report = await hybrid.run(CTX);

    expect(report.candidates).toHaveLength(3);
    const outcomes = report.candidates.map((c) => c.outcome);
    expect(outcomes[0]).toBe('VERIFIED_PROMOTED');
    expect(outcomes[1]).toBe('REFUTED');
    expect(outcomes[2]).toBe('REFUTED');

    const promoted = kernel.getResult(report.candidates[0]!.resultId)!;
    expect(promoted.verification.state).toBe('L2');
    expect(promoted.engineSource).toBe('neural:mock-transformer@0.1.0');

    const refuted = kernel.getResult(report.candidates[1]!.resultId)!;
    expect(refuted.verification.state).toBe('L1');
    expect(refuted.verification.warnings).toContain('REFUTED');

    const snap = hybrid.metricsSnapshot();
    expect(snap.proposals).toBe(3);
    expect(snap.firstAttemptCorrectness).toBeCloseTo(1 / 3);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('leaves a candidate at L1 with no verdict when verification is inconclusive', async () => {
    const kernel = new EvidenceKernel();
    const hybrid = new HybridDecompiler({
      kernel,
      proposer: new MockNeuralProposer(1),
      verifier: new ScriptedVerifier({ outcome: 'INCONCLUSIVE' }),
    });

    const report = await hybrid.run(CTX);

    expect(report.candidates[0]!.outcome).toBe('INCONCLUSIVE');
    const result = kernel.getResult(report.candidates[0]!.resultId)!;
    expect(result.verification.state).toBe('L1');
    expect(result.verification.warnings).toEqual([]);
    expect(hybrid.metricsSnapshot().firstAttemptCorrectness).toBeNull();
  });

  it('records refuted candidates in the falsification ledger with their proof', async () => {
    const kernel = new EvidenceKernel();
    const hybrid = new HybridDecompiler({
      kernel,
      proposer: new MockNeuralProposer(2),
      verifier: new StructuralRuleVerifier(),
    });

    await hybrid.run(CTX);

    const ledger = hybrid.falsifications();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.evidenceRef).toMatch(/^structural:\/\//);
    expect(ledger[0]!.reason).toBe('brace balance is 1');
  });
});
