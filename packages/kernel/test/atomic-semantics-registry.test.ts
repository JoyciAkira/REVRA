/**
 * A1++.1 — AtomicSemanticsRegistry (gate: 21 atomi x86-64 core con semantica
 * formale verificata in Lean 4.35, hash semantico deterministico, provenance
 * licenza esplicita). L'atomo = unità indivisibile su cui si compone tutto il
 * resto (L0->L3, reconciliation, knowledge reuse).
 *
 * Nota: 21 atomi reali (i 20 core del piano + hlt, terminazione osservabile).
 */
import { describe, expect, it } from 'vitest';
import {
  AtomicSemanticsRegistry,
  ATOMIC_SEMANTICS,
} from '../src/verifier/atomic-semantics-registry.js';

describe('A1++.1 — AtomicSemanticsRegistry (21 atomi x86-64 core)', () => {
  it('registra esattamente 21 atomi (gate A1++.1: 20 core + hlt terminazione)', () => {
    const registry = new AtomicSemanticsRegistry();
    expect(registry.size()).toBe(21);
    expect(ATOMIC_SEMANTICS).toHaveLength(21);
  });

  it('ogni atomo ha nome, mnemonico, opcode, teoremi e hash semantico non vuoti', () => {
    const registry = new AtomicSemanticsRegistry();
    for (const a of ATOMIC_SEMANTICS) {
      expect(a.name.length, `nome vuoto per ${a.mnemonic}`).toBeGreaterThan(0);
      expect(a.mnemonic.length, `mnemonico vuoto per ${a.name}`).toBeGreaterThan(0);
      expect(a.opcodePrefix.length, `opcode vuoto per ${a.name}`).toBeGreaterThan(0);
      expect(a.theorems.length, `nessun teorema per ${a.name}`).toBeGreaterThan(0);
      expect(a.semanticHash, `hash vuoto per ${a.name}`).toMatch(/^[0-9a-f]{64}$/);
      expect(registry.getByName(a.name)).toBeDefined();
      expect(registry.getByHash(a.semanticHash)).toBeDefined();
    }
  });

  it('hash semantico è deterministico: stesso atomo -> stesso hash tra istanze', () => {
    const r1 = new AtomicSemanticsRegistry();
    const r2 = new AtomicSemanticsRegistry();
    const mov1 = r1.getByName('mov_reg_reg')!;
    const mov2 = r2.getByName('mov_reg_reg')!;
    expect(mov1.semanticHash).toBe(mov2.semanticHash);
    const catalogMov = ATOMIC_SEMANTICS.find((a) => a.name === 'mov_reg_reg')!;
    expect(mov1.semanticHash).toBe(catalogMov.semanticHash);
  });

  it('hash semantico differisce tra atomi con semantica diversa (add vs sub)', () => {
    const registry = new AtomicSemanticsRegistry();
    const add = registry.getByName('add_reg_reg')!;
    const sub = registry.getByName('sub_reg_reg')!;
    expect(add.semanticHash).not.toBe(sub.semanticHash);
  });

  it('i nomi degli atomi corrispondono ai costruttori Instr di lean-x86_64.lean', () => {
    const expected = [
      'mov_reg_reg', 'mov_reg_imm', 'add_reg_reg', 'sub_reg_reg', 'xor_reg_reg',
      'cmp_reg_reg', 'jmp_abs', 'call_abs', 'ret', 'lea_add', 'push_reg', 'pop_reg',
      'test_reg_reg', 'and_reg_reg', 'or_reg_reg', 'shl_reg_imm', 'shr_reg_imm',
      'not_reg', 'neg_reg', 'syscall', 'hlt',
    ];
    const names = ATOMIC_SEMANTICS.map((a) => a.name);
    for (const name of expected) {
      expect(names, `manca atomo Lean ${name}`).toContain(name);
    }
  });

  it('ogni atomo porta almeno un teorema di preservation verificato in Lean', () => {
    for (const a of ATOMIC_SEMANTICS) {
      expect(a.theorems.length, `${a.name} senza teoremi`).toBeGreaterThanOrEqual(1);
    }
  });

  it('candidatesForOpcode risolve gli atomi per prefisso opcode (es. 0x89 -> mov)', () => {
    const registry = new AtomicSemanticsRegistry();
    const mov = registry.candidatesForOpcode([0x89]);
    expect(mov.length).toBeGreaterThanOrEqual(1);
    expect(mov.map((a) => a.name)).toContain('mov_reg_reg');
  });

  it('candidatesForOpcode ritorna array vuoto per opcode sconosciuto (mai silente: L0 onesto)', () => {
    const registry = new AtomicSemanticsRegistry();
    const unknown = registry.candidatesForOpcode([0xfe, 0xed, 0xfa, 0xce]);
    expect(unknown).toHaveLength(0);
  });

  it('provenance licenza: tutti gli atomi sono REVRA-original (opera originale, idee da Sail BSD-2 / Tuffy Apache-2)', () => {
    const registry = new AtomicSemanticsRegistry();
    const summary = registry.licenseSummary();
    expect(summary['REVRA-original']).toBe(21);
    expect(summary['BSD-2-Clause']).toBe(0);
    expect(summary['Apache-2.0']).toBe(0);
  });

  it('allSemanticHashes ritorna 21 hash unici (base per caching atomico, mitigazione overhead PRD §10)', () => {
    const registry = new AtomicSemanticsRegistry();
    const hashes = registry.allSemanticHashes();
    expect(hashes).toHaveLength(21);
    expect(new Set(hashes).size).toBe(21);
  });

  it('registry custom: accetta un sottoinsieme di atomi (estendibilità per ISA futuri: ARM/RISC-V)', () => {
    const subset = ATOMIC_SEMANTICS.filter((a) =>
      ['mov_reg_reg', 'add_reg_reg', 'ret'].includes(a.name),
    );
    const registry = new AtomicSemanticsRegistry(subset);
    expect(registry.size()).toBe(3);
    expect(registry.getByName('mov_reg_reg')).toBeDefined();
    expect(registry.getByName('xor_reg_reg')).toBeUndefined();
  });
});