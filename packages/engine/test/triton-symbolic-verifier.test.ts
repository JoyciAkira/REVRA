/**
 * A1++.4 — AtomicSymbolicVerifier (gate: integrazione Triton Apache-2.0 come
 * processo esterno, stesso seam SymbolicVerifier di Unicorn; L2 simbolico
 * per-istruzione; degradazione esplicita VERIFIER_UNAVAILABLE se Triton manca).
 *
 * Triton NON è installato nell'ambiente corrente → i test verificano il
 * contratto Graceful Degradation (PRD §0.2): il verifier dichiara onestamente
 * di non essere disponibile invece di crashare o fingere. Quando Triton sarà
 * installato, lo stesso harness eseguirà symbolic execution reale atomo-per-atomo.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AtomicSymbolicVerifier } from '../src/behavioral/triton-symbolic-verifier.js';

const CTX = { binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', addressRange: { start: '0x401000', end: '0x4010ff' } };

function symbolicCandidate(asmBytesHex: string, expectedRax: number) {
  return {
    claim: { kind: 'behavioral-case' as const, payload: { asmBytesHex, expectedRax } },
    confidence: 0.9,
    modelId: 'asm',
    modelVersion: '0',
  };
}

describe('A1++.4 — AtomicSymbolicVerifier (Triton, symbolic per-istruzione)', () => {
  it('espone il contratto SymbolicVerifier: verifierId + version stabili', () => {
    const v = new AtomicSymbolicVerifier();
    expect(v.verifierId).toBe('triton-atomic-symbolic');
    expect(v.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('isAvailable() ritorna boolean coerente con lo stato reale di Triton (probe python)', () => {
    const v = new AtomicSymbolicVerifier();
    const available = v.isAvailable();
    expect(typeof available).toBe('boolean');
    // Probe deterministico: due chiamate consecutive danno lo stesso risultato.
    expect(v.isAvailable()).toBe(available);
  });

  it('GATE DEGRADAZIONE: se Triton non è installato, verify() ritorna INCONCLUSIVE con VERIFIER_UNAVAILABLE esplicito (mai silente, PRD §0.2)', async () => {
    const v = new AtomicSymbolicVerifier();
    if (v.isAvailable()) {
      return console.warn('triton installato: skip gate degradazione (verifica reale coperta altrove)');
    }
    // mov eax,60; ret — candidato symbolic-testable valido.
    const verdict = await v.verify(symbolicCandidate('b83c000000c3', 60), CTX);
    expect(verdict.outcome).toBe('INCONCLUSIVE');
    expect(verdict.reason).toContain('VERIFIER_UNAVAILABLE');
    // La ragione guida esplicitamente al fallback L2 empirico (Unicorn): onestà operativa.
    expect(verdict.reason!.toLowerCase()).toContain('unicorn');
  });

  it('candidato non symbolic-testable (manca asmBytesHex/expectedRax) → INCONCLUSIVE esplicito, senza toccare Triton', async () => {
    const v = new AtomicSymbolicVerifier();
    const bad = {
      claim: { kind: 'decompilation' as const, payload: { pseudocode: 'int f(){return 1;}' } },
      confidence: 0.5,
      modelId: 'neural',
      modelVersion: '1',
    };
    const verdict = await v.verify(bad, CTX);
    expect(verdict.outcome).toBe('INCONCLUSIVE');
    expect(verdict.reason).toContain('non symbolic-testable');
  });

  it('script python risolvibile: il percorso dello harness triton_symbolic.py esiste nel repo', () => {
    // Il test gira con cwd = packages/engine; lo script è in packages/engine/scripts/.
    // Provo sia il percorso relativo al cwd del test sia quello relativo alla root del monorepo.
    const candidates = [
      'scripts/triton_symbolic.py',
      join(process.cwd(), 'scripts/triton_symbolic.py'),
      join(process.cwd(), '..', '..', 'packages/engine/scripts/triton_symbolic.py'),
    ];
    const found = candidates.some((p) => existsSync(p));
    expect(found, `harness triton_symbolic.py non trovato in: ${candidates.join(', ')}`).toBe(true);
  });

  it('traceInstructions ritorna null quando Triton non è disponibile (degradazione coerente, mai crash)', async () => {
    const v = new AtomicSymbolicVerifier();
    if (v.isAvailable()) {
      return console.warn('triton installato: skip gate trace degradazione');
    }
    const trace = await v.traceInstructions(symbolicCandidate('b83c000000c3', 60), CTX);
    expect(trace).toBeNull();
  });
});