/**
 * A1++.3 — AtomicReconciler (gate: confronto cross-engine a livello
 * istruzionale; discrepanza add vs lea → DISPUTED atomico con ragione
 * semantica sui flag). Risolve il pain #1 dei prospect defense/finance:
 * "Ghidra e radare2 disagree e non so a chi credere" → REVRA dice QUALE atomo
 * è in disputa e PERCHÉ semanticamente, mai un vago "le funzioni differiscono".
 * Coerente con PRD §0.1 Conflict Visibility: discrepanze esposte, mai nascoste.
 */
import { describe, expect, it } from 'vitest';
import { AtomicReconciler, type InstructionClaim } from '../src/verifier/atomic-reconciler.js';
import { AtomicSemanticsRegistry } from '../src/verifier/atomic-semantics-registry.js';

function claim(engine: string, address: string, atomName: string, opcode: number[] = [0x90]): InstructionClaim {
  return { engine, address, atomName, opcodeBytes: opcode };
}

describe('A1++.3 — AtomicReconciler (reconciliation istruzionale cross-engine)', () => {
  it('AGREED quando due motori propongono lo stesso atomo semantico allo stesso indirizzo', () => {
    const registry = new AtomicSemanticsRegistry();
    const reconciler = new AtomicReconciler(registry);
    const ghidra = [claim('ghidra', '0x401000', 'add_reg_reg', [0x01])];
    const radare = [claim('radare2', '0x401000', 'add_reg_reg', [0x01])];
    const result = reconciler.reconcile(ghidra, radare);
    expect(result.verdict).toBe('AGREED');
    expect(result.disputes).toHaveLength(0);
    expect(result.agreedAtoms).toHaveLength(1);
    expect(result.agreedAtoms[0].atomName).toBe('add_reg_reg');
    expect(result.agreedAtoms[0].engines).toEqual(['ghidra', 'radare2']);
  });

  it('GATE: add vs lea allo stesso indirizzo → DISPUTED atomico con ragione semantica sui flag', () => {
    // Caso reale classico: Ghidra dice "add rax, rbx" (modifica ZF/CF),
    // radare2 dice "lea rax, [rax+rbx]" (calcola la somma MA NON tocca i flag).
    // Stesso effetto su rax, semantica DIVERSA sui flag → disputa precisa.
    const registry = new AtomicSemanticsRegistry();
    const reconciler = new AtomicReconciler(registry);
    const ghidra = [claim('ghidra', '0x401005', 'add_reg_reg', [0x01])];
    const radare = [claim('radare2', '0x401005', 'lea_add', [0x8d])];
    const result = reconciler.reconcile(ghidra, radare);
    expect(result.verdict).toBe('DISPUTED');
    expect(result.disputes).toHaveLength(1);
    expect(result.agreedAtoms).toHaveLength(0);
    const dispute = result.disputes[0];
    expect(dispute.address).toBe('0x401005');
    expect(dispute.claimA.atomName).toBe('add_reg_reg');
    expect(dispute.claimB.atomName).toBe('lea_add');
    // Ragione semantica esplicita: add modifica i flag, lea no.
    expect(dispute.semanticReason.toLowerCase()).toContain('flag');
    expect(dispute.hashA).not.toBe(dispute.hashB);
  });

  it('reconcilia molti indirizzi: mistura di AGREED e DISPUTED nello stesso batch', () => {
    const registry = new AtomicSemanticsRegistry();
    const reconciler = new AtomicReconciler(registry);
    const ghidra = [
      claim('ghidra', '0x1000', 'mov_reg_reg', [0x89]),   // accordo
      claim('ghidra', '0x1005', 'add_reg_reg', [0x01]),   // disputa vs lea
      claim('ghidra', '0x100a', 'xor_reg_reg', [0x31]),   // accordo
    ];
    const radare = [
      claim('radare2', '0x1000', 'mov_reg_reg', [0x89]),
      claim('radare2', '0x1005', 'lea_add', [0x8d]),
      claim('radare2', '0x100a', 'xor_reg_reg', [0x31]),
    ];
    const result = reconciler.reconcile(ghidra, radare);
    expect(result.verdict).toBe('DISPUTED');
    expect(result.agreedAtoms).toHaveLength(2); // mov + xor
    expect(result.disputes).toHaveLength(1);    // add vs lea
    expect(result.disputes[0].address).toBe('0x1005');
  });

  it('atomo non registrato in uno dei claim → DISPUTED esplicito (mai silente)', () => {
    const registry = new AtomicSemanticsRegistry();
    const reconciler = new AtomicReconciler(registry);
    const ghidra = [claim('ghidra', '0x2000', 'add_reg_reg', [0x01])];
    const radare = [claim('radare2', '0x2000', 'istruzione_ignota', [0xfe])];
    const result = reconciler.reconcile(ghidra, radare);
    expect(result.verdict).toBe('DISPUTED');
    expect(result.disputes).toHaveLength(1);
    expect(result.disputes[0].semanticReason).toContain('non registrato');
  });

  it('indirizzi presenti in un solo motore non generano disputa (confronto solo sul comune)', () => {
    const registry = new AtomicSemanticsRegistry();
    const reconciler = new AtomicReconciler(registry);
    const ghidra = [
      claim('ghidra', '0x3000', 'mov_reg_reg', [0x89]),
      claim('ghidra', '0x3008', 'ret', [0xc3]), // solo in ghidra
    ];
    const radare = [claim('radare2', '0x3000', 'mov_reg_reg', [0x89])];
    const result = reconciler.reconcile(ghidra, radare);
    // Solo l'indirizzo comune 0x3000 viene confrontato → AGREED.
    expect(result.verdict).toBe('AGREED');
    expect(result.agreedAtoms).toHaveLength(1);
    expect(result.disputes).toHaveLength(0);
  });

  it('ogni disputa porta gli hash semantici dei due atomi (diagnostica + caching atomico A1++.2)', () => {
    const registry = new AtomicSemanticsRegistry();
    const reconciler = new AtomicReconciler(registry);
    const ghidra = [claim('ghidra', '0x4000', 'sub_reg_reg', [0x29])];
    const radare = [claim('radare2', '0x4000', 'add_reg_reg', [0x01])];
    const result = reconciler.reconcile(ghidra, radare);
    expect(result.disputes).toHaveLength(1);
    const d = result.disputes[0];
    expect(d.hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(d.hashB).toMatch(/^[0-9a-f]{64}$/);
    // Gli hash coincidono con quelli del registry.
    expect(d.hashA).toBe(registry.getByName('sub_reg_reg')!.semanticHash);
    expect(d.hashB).toBe(registry.getByName('add_reg_reg')!.semanticHash);
  });
});