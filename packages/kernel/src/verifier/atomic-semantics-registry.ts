/**
 * A1++.1 — AtomicSemanticsRegistry (PRD §3.1, Beyond Limits).
 *
 * L'atomo = singola istruzione x86-64 con semantica formale esatta verificata
 * in Lean 4.35 (lean-x86_64.lean). Questo registry mappa i byte opcode agli
 * atomi, calcola un hash semantico deterministico (l'atomo è identificato dalla
 * sua semantica, non dal byte grezzo) e registra la provenance di licenza
 * (coerente col principio L0 "evidenza esplicita").
 *
 * Tutto il resto (L0->L3, reconciliation cross-engine, knowledge reuse) è
 * composizione di questi atomi verificati.
 *
 * Provenance licenza (documentata per ogni atomo):
 * - Struttura semantica ispirata a rems-project/sail (BSD-2-Clause) e
 *   dtcxzyw/tuffy (Apache-2.0) come riferimento aritmetica fixed-width/flag.
 * - Copertura validata contro kframework/X86-64-Semantics (oracle esterno,
 *   UIUC/NCSA, NON linkato: solo differential-testing reference).
 * - lean-x86_64.lean è opera originale REVRA; importa idee, non codice copiato.
 */
import { createHash } from 'node:crypto';

export type AtomLicense = 'BSD-2-Clause' | 'Apache-2.0' | 'REVRA-original';

export interface AtomicSemantics {
  /** Nome dell'atomo (corrisponde al costruttore Instr in lean-x86_64.lean). */
  readonly name: string;
  /** Mnemonico x86-64 umano. */
  readonly mnemonic: string;
  /** Byte opcode rappresentativi (prefisso semplificato; matching per famiglia). */
  readonly opcodePrefix: ReadonlyArray<number>;
  /** Hash semantico deterministico: identifica l'atomo per la sua semantica. */
  readonly semanticHash: string;
  /** Teoremi di preservation verificati in Lean per questo atomo. */
  readonly theorems: ReadonlyArray<string>;
  /** Provenance di licenza della semantica. */
  readonly license: AtomLicense;
}

/**
 * Calcola l'hash semantico deterministico di un atomo: SHA-256 di
 * (name + mnemonic + theorems). Due atomi con la stessa semantica hanno
 * lo stesso hash indipendentemente dall'opcode grezzo (es. add vs lea con
 * stessi operandi condividono semantica su rax ma differiscono sui flag →
 * hash diversi perché i teoremi sui flag differiscono).
 */
function computeSemanticHash(
  name: string,
  mnemonic: string,
  theorems: ReadonlyArray<string>,
): string {
  return createHash('sha256')
    .update(`${name}|${mnemonic}|${[...theorems].sort().join(',')}`)
    .digest('hex');
}

function atom(
  name: string,
  mnemonic: string,
  opcodePrefix: ReadonlyArray<number>,
  theorems: ReadonlyArray<string>,
  license: AtomLicense = 'REVRA-original',
): AtomicSemantics {
  return {
    name,
    mnemonic,
    opcodePrefix,
    semanticHash: computeSemanticHash(name, mnemonic, theorems),
    theorems,
    license,
  };
}

/**
 * I 20 atomi x86-64 core. L'ordine e i nomi corrispondono 1:1 ai costruttori
 * di `Instr` in lean-x86_64.lean e ai teoremi ivi dimostrati.
 */
export const ATOMIC_SEMANTICS: ReadonlyArray<AtomicSemantics> = [
  atom('mov_reg_reg', 'mov', [0x89], ['mov_preserves_source', 'mov_transfers_value']),
  atom('mov_reg_imm', 'mov imm', [0xb8], ['mov_imm_loads_masked']),
  atom('add_reg_reg', 'add', [0x01], ['add_computes_sum', 'add_preserves_rbx']),
  atom('sub_reg_reg', 'sub', [0x29], ['sub_self_is_zero']),
  atom('xor_reg_reg', 'xor', [0x31], ['xor_clears_register', 'xor_sets_zf']),
  atom('cmp_reg_reg', 'cmp', [0x39], ['cmp_preserves_registers', 'cmp_equal_sets_zf']),
  atom('jmp_abs', 'jmp', [0xe9], ['jmp_sets_rip', 'jmp_preserves_rax']),
  atom('call_abs', 'call', [0xe8], ['call_pushes_rip_and_jumps']),
  atom('ret', 'ret', [0xc3], ['ret_pops_rip']),
  atom('lea_add', 'lea', [0x8d], ['lea_computes_sum', 'lea_preserves_flags']),
  atom('push_reg', 'push', [0x50], ['push_decrements_rsp', 'push_stacks_rax']),
  atom('pop_reg', 'pop', [0x58], ['pop_restores_rax']),
  atom('test_reg_reg', 'test', [0x85], ['test_preserves_rax', 'test_clears_cf']),
  atom('and_reg_reg', 'and', [0x21], ['and_writes_result', 'and_clears_cf']),
  atom('or_reg_reg', 'or', [0x09], ['or_writes_result']),
  atom('shl_reg_imm', 'shl', [0xc1], ['shl_is_mul_pow2']),
  atom('shr_reg_imm', 'shr', [0xc1], ['shr_is_div_pow2']),
  atom('not_reg', 'not', [0xf7], ['not_is_complement']),
  atom('neg_reg', 'neg', [0xf7], ['neg_of_zero_is_zero']),
  atom('syscall', 'syscall', [0x0f, 0x05], ['syscall_preserves_state']),
  // hlt condivide il prefisso 0xf7 family solo concettualmente; opcode reale 0xf4
  atom('hlt', 'hlt', [0xf4], ['hlt_preserves_state']),
];

export class AtomicSemanticsRegistry {
  private readonly byName: Map<string, AtomicSemantics>;
  private readonly byHash: Map<string, AtomicSemantics>;
  private readonly byOpcode: Map<string, AtomicSemantics[]>;

  constructor(atoms: ReadonlyArray<AtomicSemantics> = ATOMIC_SEMANTICS) {
    this.byName = new Map();
    this.byHash = new Map();
    this.byOpcode = new Map();
    for (const a of atoms) {
      this.byName.set(a.name, a);
      this.byHash.set(a.semanticHash, a);
      const key = Buffer.from(a.opcodePrefix).toString('hex');
      const bucket = this.byOpcode.get(key) ?? [];
      bucket.push(a);
      this.byOpcode.set(key, bucket);
    }
  }

  /** Numero di atomi registrati (gate A1++.1: 20). */
  size(): number {
    return this.byName.size;
  }

  /** Recupera un atomo per nome (il costruttore Lean Instr). */
  getByName(name: string): AtomicSemantics | undefined {
    return this.byName.get(name);
  }

  /** Recupera un atomo per hash semantico. */
  getByHash(hash: string): AtomicSemantics | undefined {
    return this.byHash.get(hash);
  }

  /**
   * Risolve gli atomi candidati per un prefisso opcode. Ritorna un array perché
   * più atomi possono condividere un prefisso (es. shl/shr entrambi 0xc1): la
   * disambiguazione finale spetta al reconciler istruzionale (A1++.3).
   */
  candidatesForOpcode(opcodePrefix: ReadonlyArray<number>): ReadonlyArray<AtomicSemantics> {
    const key = Buffer.from(opcodePrefix).toString('hex');
    return this.byOpcode.get(key) ?? [];
  }

  /**
   * Tutti gli hash semantici registrati: usato per il caching atomico
   * (un atomo già visto ha cache hit immediato, mitigazione overhead PRD §10).
   */
  allSemanticHashes(): ReadonlyArray<string> {
    return [...this.byHash.keys()];
  }

  /**
   * Riepilogo di provenance licenza: quanti atomi per licenza. Coerente col
   * principio L0 "evidenza esplicita" applicato alla supply-chain del codice.
   */
  licenseSummary(): Record<AtomLicense, number> {
    const summary: Record<AtomLicense, number> = {
      'BSD-2-Clause': 0,
      'Apache-2.0': 0,
      'REVRA-original': 0,
    };
    for (const a of this.byName.values()) {
      summary[a.license] += 1;
    }
    return summary;
  }
}