/**
 * A1 — Semantiche Lean x86_64 reali: teoremi non-tautologici verificati
 * dal toolchain lean + proof caching (cache hit sulla seconda verifica).
 *
 * Il modulo lean-x86_64.lean definisce semantiche parziali (mov/add/sub/xor/cmp)
 * con flag EFLAGS e 4 teoremi di preservation. Questi test li verificano
 * realmente via Lean4CliVerifier e controllano il caching.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lean4CliVerifier } from '../src/verifier/lean4-cli.js';
import { ProofCache } from '../src/verifier/proof-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const X86_MODULE = readFileSync(
  join(__dirname, '..', 'src', 'verifier', 'lean-x86_64.lean'),
  'utf8',
);

// Helper: costruisce un proofTerm che importa il modulo x86_64 e dimostra un teorema.
function proofFor(theorem: string): string {
  return `${X86_MODULE}

-- Verification target: ${theorem}
#check RevraX86_64.${theorem}
`;
}

const BASE_CERT = {
  resultId: 'a1-x86',
  semanticModel: 'revra-x86_64',
  property: 'preservation',
  assumptions: [],
  binaryHash: 'a1b2c3d4e5f60718',
  instructionRange: { start: '0x0', end: '0x10' },
  arch: 'x86_64',
};

describe('A1 — Semantiche Lean x86_64 reali (teoremi non-tautologici)', () => {
  const leanPromise = Lean4CliVerifier.detect();

  it('modulo x86_64 compilato: mov_preserves_source verificato', { timeout: 30_000 }, async () => {
    const lean = await leanPromise;
    if (!lean) return console.warn('lean non installato: skip');
    const run = await lean.verify({
      ...BASE_CERT,
      theorem: 'mov_preserves_source',
      proofTerm: proofFor('mov_preserves_source'),
    });
    expect(run.outcome).toBe('VERIFIED');
  });

  it('add_computes_sum: semantica add reale verificata', { timeout: 30_000 }, async () => {
    const lean = await leanPromise;
    if (!lean) return console.warn('lean non installato: skip');
    const run = await lean.verify({
      ...BASE_CERT,
      theorem: 'add_computes_sum',
      proofTerm: proofFor('add_computes_sum'),
    });
    expect(run.outcome).toBe('VERIFIED');
  });

  it('xor_clears_register: semantica xor reale verificata', { timeout: 30_000 }, async () => {
    const lean = await leanPromise;
    if (!lean) return console.warn('lean non installato: skip');
    const run = await lean.verify({
      ...BASE_CERT,
      theorem: 'xor_clears_register',
      proofTerm: proofFor('xor_clears_register'),
    });
    expect(run.outcome).toBe('VERIFIED');
  });

  it('cmp_sets_zf: semantica cmp/flag reale verificata', { timeout: 30_000 }, async () => {
    const lean = await leanPromise;
    if (!lean) return console.warn('lean non installato: skip');
    const run = await lean.verify({
      ...BASE_CERT,
      theorem: 'cmp_sets_zf',
      proofTerm: proofFor('cmp_sets_zf'),
    });
    expect(run.outcome).toBe('VERIFIED');
  });

  it('add_preserves_rbx: add non modifica il registro sorgente (A1+ preservation reale)', { timeout: 30_000 }, async () => {
    const lean = await leanPromise;
    if (!lean) return console.warn('lean non installato: skip');
    const run = await lean.verify({
      ...BASE_CERT,
      theorem: 'add_preserves_rbx',
      proofTerm: proofFor('add_preserves_rbx'),
    });
    expect(run.outcome).toBe('VERIFIED');
  });

  it('sub_self_is_zero: sub di un registro con se stesso dà zero e setta ZF (A1+ preservation reale)', { timeout: 30_000 }, async () => {
    const lean = await leanPromise;
    if (!lean) return console.warn('lean non installato: skip');
    const run = await lean.verify({
      ...BASE_CERT,
      theorem: 'sub_self_is_zero',
      proofTerm: proofFor('sub_self_is_zero'),
    });
    expect(run.outcome).toBe('VERIFIED');
  });

  it('mov_transfers_value: mov trasferisce il valore correttamente (A1+ preservation reale)', { timeout: 30_000 }, async () => {
    const lean = await leanPromise;
    if (!lean) return console.warn('lean non installato: skip');
    const run = await lean.verify({
      ...BASE_CERT,
      theorem: 'mov_transfers_value',
      proofTerm: proofFor('mov_transfers_value'),
    });
    expect(run.outcome).toBe('VERIFIED');
  });

  it('cmp_preserves_registers: cmp non modifica i registri, solo i flag (A1+ preservation reale)', { timeout: 30_000 }, async () => {
    const lean = await leanPromise;
    if (!lean) return console.warn('lean non installato: skip');
    const run = await lean.verify({
      ...BASE_CERT,
      theorem: 'cmp_preserves_registers',
      proofTerm: proofFor('cmp_preserves_registers'),
    });
    expect(run.outcome).toBe('VERIFIED');
  });
});

describe('A1 — Proof caching (evita ri-verifica, mitigazione overhead PRD §10)', () => {
  it('seconda verifica dello stesso theorem è cache hit (<100ms, no lean spawn)', { timeout: 30_000 }, async () => {
    const cache = new ProofCache();
    const lean = await Lean4CliVerifier.detect(undefined, cache);
    if (!lean) return console.warn('lean non installato: skip');

    const cert = {
      ...BASE_CERT,
      theorem: 'xor_clears_register',
      proofTerm: proofFor('xor_clears_register'),
    };

    // Prima verifica: esegue lean realmente.
    const first = await lean.verify(cert);
    expect(first.outcome).toBe('VERIFIED');
    expect(cache.size()).toBe(1);

    // Seconda verifica: deve essere cache hit, quasi istantanea.
    const t0 = Date.now();
    const second = await lean.verify(cert);
    const elapsed = Date.now() - t0;

    expect(second.outcome).toBe('VERIFIED');
    expect(second.detail).toContain('[cache hit]');
    expect(elapsed).toBeLessThan(100); // gate A1: cache hit <100ms
    expect(cache.size()).toBe(1);
  });

  it('proof fallito viene cachato come PROOF_FAILED (deterministico)', { timeout: 30_000 }, async () => {
    const cache = new ProofCache();
    const lean = await Lean4CliVerifier.detect(undefined, cache);
    if (!lean) return console.warn('lean non installato: skip');

    const cert = {
      ...BASE_CERT,
      theorem: 'broken',
      proofTerm: `${X86_MODULE}\ntheorem broken : False := trivial\n`,
    };

    const first = await lean.verify(cert);
    expect(first.outcome).toBe('PROOF_FAILED');
    expect(cache.size()).toBe(1);

    const second = await lean.verify(cert);
    expect(second.outcome).toBe('PROOF_FAILED');
    expect(second.detail).toContain('[cache hit]');
  });
});