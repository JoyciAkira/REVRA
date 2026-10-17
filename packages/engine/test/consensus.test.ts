/**
 * Consensus seam (PRD §3.1): quorum decides, equivocators are flagged
 * Byzantine, exact disagreements stay DISPUTED, agreed claims land in the
 * Shared Formal State — and the round latency meets the <1ms target.
 */
import { describe, expect, it } from 'vitest';
import { ConsensusEngine, claimHash } from '../src/consensus/consensus-engine.js';
import type { Claim, EngineSubmission } from '../src/consensus/consensus-engine.js';

function submission(engineId: string, pseudocode: string): EngineSubmission {
  return {
    engineId,
    binaryHash: 'a1b2c3d4e5f60718',
    addressRange: { start: '0x401000', end: '0x4010ff' },
    claim: { kind: 'decompilation', payload: { pseudocode } },
  };
}

const SAME: Claim = { kind: 'decompilation', payload: { pseudocode: 'int f() { return 1; }' } };

describe('ConsensusEngine', () => {
  it('reaches CONSENSUS at quorum and publishes into the shared formal state', () => {
    const engine = new ConsensusEngine();

    const decision = engine.submitRound([
      submission('ghidra', 'int f() { return 1; }'),
      submission('radare2', 'int f() { return 1; }'),
      submission('d810', 'int f() { return 1; }'),
    ]);

    expect(decision.outcome).toBe('CONSENSUS');
    expect(decision.agreedClaimHash).toBe(claimHash(SAME));
    expect(decision.acceptedEngines).toHaveLength(3);
    expect(decision.sharedStateVersion).toBe(1);
    expect(engine.sharedState.since(0)).toHaveLength(1);
  });

  it('flags equivocating engines as Byzantine and decides without them', () => {
    const engine = new ConsensusEngine();

    const decision = engine.submitRound([
      submission('ghidra', 'int f() { return 1; }'),
      submission('radare2', 'int f() { return 1; }'),
      submission('crooked', 'int f() { return 1; }'),
      submission('crooked', 'int f() { return 2; }'),
    ]);

    expect(decision.outcome).toBe('CONSENSUS');
    expect(decision.byzantineEngines).toEqual(['crooked']);
    expect(decision.rejected.some((r) => r.engineId === 'crooked')).toBe(true);
    expect(engine.metrics().byzantineEngines).toContain('crooked');
  });

  it('stays DISPUTED when two claims split the vote below quorum', () => {
    const engine = new ConsensusEngine();

    const decision = engine.submitRound([
      submission('ghidra', 'int f() { return 1; }'),
      submission('radare2', 'int f() { return 2; }'),
    ]);

    expect(decision.outcome).toBe('DISPUTED');
    expect(decision.sharedStateVersion).toBeNull();
    expect(engine.sharedState.version).toBe(0);
  });

  it('answers INSUFFICIENT_QUORUM for a single submission', () => {
    const engine = new ConsensusEngine();

    const decision = engine.submitRound([submission('ghidra', 'int f() { return 1; }')]);

    expect(decision.outcome).toBe('INSUFFICIENT_QUORUM');
  });

  it('keeps p50/p99 latency under the 1ms target across rounds', () => {
    const engine = new ConsensusEngine();
    for (let i = 0; i < 20; i += 1) {
      engine.submitRound([
        submission('ghidra', `int f() { return ${i}; }`),
        submission('radare2', `int f() { return ${i}; }`),
      ]);
    }

    const metrics = engine.metrics();
    expect(metrics.rounds).toBe(20);
    expect(metrics.consensus).toBe(20);
    expect(metrics.p50Ms).not.toBeNull();
    expect(metrics.p99Ms!).toBeLessThan(1);
  });
});
