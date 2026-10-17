/**
 * A1++.2 — AtomicEvidenceComposer (gate composizionale: modificare 1 atomo
 * invalida SOLO i proof che lo toccano; gli altri restano L3). Questo è il
 * cuore del principio "atomicità": cambiare 1 istruzione non richiede di
 * rivalutare tutta la funzione, ma solo i proof dipendenti. Mitigazione
 * strutturale dell'overhead di formal verification (PRD §10).
 */
import { describe, expect, it } from 'vitest';
import { AtomicEvidenceComposer, ATOMIC_STALE_STATUS } from '../src/verifier/atomic-evidence-composer.js';
import {
  AtomicSemanticsRegistry,
  ATOMIC_SEMANTICS,
  type AtomicSemantics,
} from '../src/verifier/atomic-semantics-registry.js';

describe('A1++.2 — AtomicEvidenceComposer (composizione atomica L0->L3)', () => {
  it('bindProof vincola un proof agli hash semantici correnti degli atomi dichiarati', () => {
    const registry = new AtomicSemanticsRegistry();
    const composer = new AtomicEvidenceComposer(registry);
    const binding = composer.bindProof('proof-mov-add', ['mov_reg_reg', 'add_reg_reg']);
    expect(binding.proofId).toBe('proof-mov-add');
    expect(binding.atomNames).toEqual(['mov_reg_reg', 'add_reg_reg']);
    expect(binding.atomHashes).toHaveLength(2);
    // Gli hash coincidono con quelli correnti del registry.
    expect(binding.atomHashes[0]).toBe(registry.getByName('mov_reg_reg')!.semanticHash);
    expect(binding.atomHashes[1]).toBe(registry.getByName('add_reg_reg')!.semanticHash);
  });

  it('bindProof lancia su atomo non registrato (mai silente: proof su semantica inesistente = errore)', () => {
    const registry = new AtomicSemanticsRegistry();
    const composer = new AtomicEvidenceComposer(registry);
    expect(() => composer.bindProof('proof-bad', ['istruzione_fantasma'])).toThrow(/non registrato/);
  });

  it('checkBinding: proof valido quando tutti gli atomi mantengono lo stesso hash (restano L3)', () => {
    const registry = new AtomicSemanticsRegistry();
    const composer = new AtomicEvidenceComposer(registry);
    const binding = composer.bindProof('proof-stable', ['mov_reg_reg', 'xor_reg_reg']);
    // Registry invariato -> tutti gli atomi hanno lo stesso hash -> proof valido.
    const result = composer.checkBinding(binding);
    expect(result.valid).toBe(true);
    expect(result.staleAtoms).toHaveLength(0);
  });

  it('GATE COMPOSIZIONALE: modificare 1 atomo invalida SOLO i proof che lo toccano, gli altri restano L3', () => {
    // Costruisco un registry "vivo" dove posso mutare la semantica di un atomo.
    const atoms = [...ATOMIC_SEMANTICS];
    const movIdx = atoms.findIndex((a) => a.name === 'mov_reg_reg');
    const addIdx = atoms.findIndex((a) => a.name === 'add_reg_reg');
    const xorIdx = atoms.findIndex((a) => a.name === 'xor_reg_reg');

    const registry = new AtomicSemanticsRegistry(atoms);
    const composer = new AtomicEvidenceComposer(registry);

    // Due proof: uno tocca {mov, add}, l'altro tocca {xor} (disgiunto).
    const bindingMovAdd = composer.bindProof('proof-mov-add', ['mov_reg_reg', 'add_reg_reg']);
    const bindingXor = composer.bindProof('proof-xor', ['xor_reg_reg']);

    // Stato iniziale: entrambi validi.
    expect(composer.checkBinding(bindingMovAdd).valid).toBe(true);
    expect(composer.checkBinding(bindingXor).valid).toBe(true);

    // MUTAZIONE: cambio la semantica di `mov_reg_reg` (simula una correzione
    // della semantica in una nuova versione del modulo Lean). Ricostruisco il
    // registry con un atomo `mov` il cui hash semantico è diverso (teoremi diversi).
    const mutatedMov: AtomicSemantics = {
      ...atoms[movIdx],
      theorems: ['mov_preserves_source', 'mov_transfers_value', 'mov_nuovo_teorema'],
      semanticHash: 'mutated-hash-mov-reg-reg'.padEnd(64, '0'),
    };
    const mutatedAtoms = [...atoms];
    mutatedAtoms[movIdx] = mutatedMov;
    const registryMutated = new AtomicSemanticsRegistry(mutatedAtoms);
    const composerMutated = new AtomicEvidenceComposer(registryMutated);

    // Il proof che tocca `mov` (proof-mov-add) ora è STALE: solo lui si rompe.
    const resultMovAdd = composerMutated.checkBinding(bindingMovAdd);
    expect(resultMovAdd.valid).toBe(false);
    expect(resultMovAdd.staleAtoms).toHaveLength(1);
    expect(resultMovAdd.staleAtoms[0].name).toBe('mov_reg_reg');
    expect(resultMovAdd.staleAtoms[0].currentHash).toBe(mutatedMov.semanticHash);

    // Il proof disgiunto (proof-xor) RESTA VALIDO: non tocca l'atomo mutato.
    // Questo è il gate composizionale: cambiare 1 atomo non invalida tutto.
    const resultXor = composerMutated.checkBinding(bindingXor);
    expect(resultXor.valid).toBe(true);
    expect(resultXor.staleAtoms).toHaveLength(0);

    // Anche un proof che tocca solo `add` (non mutato) resta valido.
    const bindingAdd = composer.bindProof('proof-add-only', ['add_reg_reg']);
    expect(composerMutated.checkBinding(bindingAdd).valid).toBe(true);
  });

  it('checkBinding: atomo rimosso dal registry rende il proof stale (fondamento semantico perso)', () => {
    const atoms = [...ATOMIC_SEMANTICS];
    const registry = new AtomicSemanticsRegistry(atoms);
    const composer = new AtomicEvidenceComposer(registry);
    const binding = composer.bindProof('proof-ret', ['ret']);

    // Ricostruisco il registry SENZA l'atomo `ret`.
    const withoutRet = atoms.filter((a) => a.name !== 'ret');
    const registryReduced = new AtomicSemanticsRegistry(withoutRet);
    const composerReduced = new AtomicEvidenceComposer(registryReduced);

    const result = composerReduced.checkBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.staleAtoms).toHaveLength(1);
    expect(result.staleAtoms[0].name).toBe('ret');
    expect(result.staleAtoms[0].currentHash).toBeUndefined(); // rimosso
  });

  it('composeBindings: unione degli atomi di due proof (sequenza mov+add vincolata a {mov,add})', () => {
    const registry = new AtomicSemanticsRegistry();
    const composer = new AtomicEvidenceComposer(registry);
    const b1 = composer.bindProof('p1', ['mov_reg_reg']);
    const b2 = composer.bindProof('p2', ['add_reg_reg', 'mov_reg_reg']); // mov duplicato
    const composed = composer.composeBindings(b1, b2);
    // Unione deduplicata: {mov, add}, non {mov, add, mov}.
    expect(composed.atomNames).toEqual(['mov_reg_reg', 'add_reg_reg']);
    expect(composed.atomHashes).toHaveLength(2);
    expect(composed.proofId).toBe('p1+p2');
    // Il proof composto resta valido finché entrambi gli atomi mantengono l'hash.
    expect(composer.checkBinding(composed).valid).toBe(true);
  });

  it('ATOMIC_STALE_STATUS è lo stato speciale esplicito per proof con atomi cambiati (coerente con PRD §0.1)', () => {
    // Nuovo stato speciale di prima classe, mai nascosto: coerente con
    // DISPUTED/UNKNOWN/UNSUPPORTED del contratto evidenza.
    expect(ATOMIC_STALE_STATUS).toBe('STALE_ATOMS');
  });
});