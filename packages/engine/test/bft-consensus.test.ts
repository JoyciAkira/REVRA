/**
 * G2.3 — Sub-ms BFT consensus (PRD §3.1, Beyond Limits).
 *
 * Gate: "consenso converge sulla risposta corretta anche con 1 motore corrotto,
 * p99 <1ms". Il ConsensusEngine esistente implementa già il protocollo BFT
 * (rilevamento equivocation → motore Byzantine droppato, quorum per CONSENSUS,
 * pubblicazione su SharedFormalState, misurazione latency p50/p99). Questo test
 * verifica il gate su un carico realistico: molte round sincrone in-process con
 * un motore che tenta di corrompere il consenso (equivocazione o claim divergente),
 * misurando che (1) il consenso converga sempre sul claim corretto degli onesti e
 * (2) la latency p99 resti sotto 1ms.
 *
 * "Sub-millisecond" è misurato, non assunto (PRD §3.1): il target <1ms p99 è
 * verificato empiricamente su N round, non dichiarato a priori.
 */
import { describe, expect, it } from 'vitest';
import { ConsensusEngine, claimHash } from '../src/consensus/consensus-engine.js';
import type { EngineSubmission } from '../src/consensus/consensus-engine.js';
import type { Claim } from '@revra/contracts';

const RANGE = { start: '0x401000', end: '0x401020' };
const BIN = 'g23-bft-binary-0001';

function submission(engineId: string, claim: Claim): EngineSubmission {
  return { engineId, binaryHash: BIN, addressRange: RANGE, claim };
}

const CORRECT_CLAIM: Claim = { kind: 'decompilation', payload: { pseudocode: 'int f(){return 0;}' } };
const WRONG_CLAIM: Claim = { kind: 'decompilation', payload: { pseudocode: 'int f(){return 999;}' } };

describe('G2.3 — Sub-ms BFT consensus (convergenza con motore corrotto + p99 <1ms)', () => {
  it('GATE BFT: con 1 motore Byzantine (equivoca due claim nella stessa round), il consenso converge sul claim corretto degli onesti', () => {
    const engine = new ConsensusEngine({ quorumSize: 2 });
    // 3 motori onesti concordano sul claim corretto; 1 motore (corrotto) equivoca
    // avanzando DUE claim diversi nella stessa round → rilevato come Byzantine e droppato.
    const decision = engine.submitRound([
      submission('ghidra', CORRECT_CLAIM),
      submission('radare2', CORRECT_CLAIM),
      submission('binaryninja', CORRECT_CLAIM),
      submission('corrupted-engine', CORRECT_CLAIM), // primo claim del corrotto
      submission('corrupted-engine', WRONG_CLAIM), // equivocation → Byzantine
    ]);
    expect(decision.outcome).toBe('CONSENSUS');
    expect(decision.byzantineEngines).toContain('corrupted-engine');
    expect(decision.agreedClaimHash).toBe(claimHash(CORRECT_CLAIM));
    // I 3 onesti sono accettati; il corrotto è escluso dagli accepted.
    expect(decision.acceptedEngines).toEqual(expect.arrayContaining(['ghidra', 'radare2', 'binaryninja']));
    expect(decision.acceptedEngines).not.toContain('corrupted-engine');
    // Il claim corretto è pubblicato nello shared formal state.
    expect(decision.sharedStateVersion).toBeGreaterThan(0);
  });

  it('GATE BFT: con 1 motore che propone un claim divergente (non equivoca), gli onesti in quorum vincono comunque', () => {
    const engine = new ConsensusEngine({ quorumSize: 2 });
    // 3 onesti concordano; 1 motore "corrotto" propone un claim diverso ma coerente
    // (non equivoca: un solo claim). Quorum degli onesti (3 >= 2) → CONSENSUS sul corretto.
    const decision = engine.submitRound([
      submission('ghidra', CORRECT_CLAIM),
      submission('radare2', CORRECT_CLAIM),
      submission('binaryninja', CORRECT_CLAIM),
      submission('outlier-engine', WRONG_CLAIM), // claim divergente, ma singolo
    ]);
    expect(decision.outcome).toBe('CONSENSUS');
    expect(decision.agreedClaimHash).toBe(claimHash(CORRECT_CLAIM));
    expect(decision.acceptedEngines).not.toContain('outlier-engine');
    // L'outlier finisce nei rejected con il suo claim hash.
    expect(decision.rejected.some((r) => r.engineId === 'outlier-engine')).toBe(true);
  });

  it('il motore Byzantine viene ricordato nelle metriche (byzantineEngines persistente across rounds)', () => {
    const engine = new ConsensusEngine({ quorumSize: 2 });
    engine.submitRound([
      submission('ghidra', CORRECT_CLAIM),
      submission('radare2', CORRECT_CLAIM),
      submission('evil', CORRECT_CLAIM),
      submission('evil', WRONG_CLAIM), // equivocation
    ]);
    // Seconda round pulita.
    engine.submitRound([
      submission('ghidra', CORRECT_CLAIM),
      submission('radare2', CORRECT_CLAIM),
    ]);
    const m = engine.metrics();
    expect(m.byzantineEngines).toContain('evil');
    expect(m.consensus).toBe(2);
  });

  it('DISPUTED: due gruppi di onesti in disaccordo esatto (nessun quorum dominante) → DISPUTED, mai silenzio', () => {
    const engine = new ConsensusEngine({ quorumSize: 3 }); // quorum alto
    // 2 motori dicono A, 2 dicono B: nessun gruppo raggiunge quorum 3 → DISPUTED.
    const decision = engine.submitRound([
      submission('ghidra', CORRECT_CLAIM),
      submission('radare2', CORRECT_CLAIM),
      submission('binaryninja', WRONG_CLAIM),
      submission('cutter', WRONG_CLAIM),
    ]);
    expect(decision.outcome).toBe('DISPUTED');
    // Conflict Visibility (PRD §0.2): la disputa è esplicita, non risolta silenziosamente.
    expect(decision.agreedClaimHash).toBeUndefined();
  });

  it('INSUFFICIENT_QUORUM: un solo motore onesto, quorum 2 → nessun consenso, esplicito', () => {
    const engine = new ConsensusEngine({ quorumSize: 2 });
    const decision = engine.submitRound([submission('ghidra', CORRECT_CLAIM)]);
    expect(decision.outcome).toBe('INSUFFICIENT_QUORUM');
  });

  it('GATE LATENCY: su 500 round sincrone, p99 < 1ms (sub-millisecond, misurato non assunto)', () => {
    const engine = new ConsensusEngine({ quorumSize: 2 });
    for (let i = 0; i < 500; i++) {
      // Round tipica: 3 onesti + 1 outlier divergente (carico realistico con fault).
      const offset = i * 0x100;
      const range = { start: `0x${(0x401000 + offset).toString(16)}`, end: `0x${(0x401020 + offset).toString(16)}` };
      const claimA: Claim = { kind: 'decompilation', payload: { pseudocode: `int f${i}(){return 0;}` } };
      const claimB: Claim = { kind: 'decompilation', payload: { pseudocode: `int f${i}(){return 1;}` } };
      engine.submitRound([
        { engineId: 'ghidra', binaryHash: BIN, addressRange: range, claim: claimA },
        { engineId: 'radare2', binaryHash: BIN, addressRange: range, claim: claimA },
        { engineId: 'binaryninja', binaryHash: BIN, addressRange: range, claim: claimA },
        { engineId: 'outlier', binaryHash: BIN, addressRange: range, claim: claimB },
      ]);
    }
    const m = engine.metrics();
    expect(m.rounds).toBe(500);
    expect(m.consensus).toBe(500);
    // Gate PRD §3.1: p99 < 1ms. Misurato empiricamente sulle 500 round.
    expect(m.p99Ms).toBeLessThan(1);
    expect(m.p50Ms).toBeLessThan(1);
  });

  it('shared formal state: dopo un CONSENSUS, il claim agreed è pubblicato e versionato (shared formal state, non solo dati)', () => {
    const engine = new ConsensusEngine({ quorumSize: 2 });
    const d1 = engine.submitRound([
      submission('ghidra', CORRECT_CLAIM),
      submission('radare2', CORRECT_CLAIM),
    ]);
    expect(d1.sharedStateVersion).toBe(1);
    // Un secondo consenso su un claim diverso incrementa la versione dello stato condiviso.
    const otherClaim: Claim = { kind: 'decompilation', payload: { pseudocode: 'int g(){return 1;}' } };
    const d2 = engine.submitRound([
      submission('ghidra', otherClaim),
      submission('radare2', otherClaim),
    ]);
    expect(d2.sharedStateVersion).toBe(2);
    expect(engine.sharedState.version).toBe(2);
  });

  it('ogni decisione riporta latencyMs misurata (trasparenza, mai latency assunta)', () => {
    const engine = new ConsensusEngine({ quorumSize: 2 });
    const decision = engine.submitRound([
      submission('ghidra', CORRECT_CLAIM),
      submission('radare2', CORRECT_CLAIM),
    ]);
    expect(typeof decision.latencyMs).toBe('number');
    expect(decision.latencyMs).toBeGreaterThanOrEqual(0);
  });
});