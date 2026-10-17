/**
 * A1++.5 — AtomicKnowledgeStore (gate: sequenze atomiche riutilizzabili con
 * confidence cumulata cross-binario; pattern riconosciuto in N binari → ipotesi
 * con confidence cumulata; incertezza calibrata che si allarga su corpus sottile).
 *
 * Il flywheel di conoscenza atomica: ogni analisi alimenta il corpus, ogni nuova
 * analisi beneficia di tutto ciò che è stato imparato prima. La conoscenza si
 * accumula su unità indivisibili (sequenze di atomi A1++.1), non su blob arbitrari.
 * Coerente con B2 (conformal prediction): mai un numero senza margine di incertezza.
 */
import { describe, expect, it } from 'vitest';
import { AtomicKnowledgeStore } from '../src/epistemic/atomic-knowledge-store.js';

describe('A1++.5 — AtomicKnowledgeStore (flywheel conoscenza atomica cross-binario)', () => {
  it('hashSequence è deterministico: stessa sequenza di atomi → stesso hash (identità della conoscenza)', () => {
    const h1 = AtomicKnowledgeStore.hashSequence(['mov_reg_imm', 'syscall']);
    const h2 = AtomicKnowledgeStore.hashSequence(['mov_reg_imm', 'syscall']);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashSequence differisce per sequenze diverse (ordine degli atomi conta)', () => {
    const h1 = AtomicKnowledgeStore.hashSequence(['mov_reg_imm', 'syscall']);
    const h2 = AtomicKnowledgeStore.hashSequence(['syscall', 'mov_reg_imm']);
    // L'ordine istruzionale è semantica: mov poi syscall ≠ syscall poi mov.
    expect(h1).not.toBe(h2);
  });

  it('buildSequence costruisce una sequenza con hash, nomi e mnemonico', () => {
    const seq = AtomicKnowledgeStore.buildSequence(['mov_reg_imm', 'syscall'], 'exit(60)');
    expect(seq.atomNames).toEqual(['mov_reg_imm', 'syscall']);
    expect(seq.mnemonic).toBe('exit(60)');
    expect(seq.sequenceHash).toBe(AtomicKnowledgeStore.hashSequence(['mov_reg_imm', 'syscall']));
  });

  it('GATE FLYWHEEL: sequenza osservata in N binari → ipotesi con confidence cumulata crescente', () => {
    const store = new AtomicKnowledgeStore();
    const exitSeq = AtomicKnowledgeStore.buildSequence(['mov_reg_imm', 'syscall'], 'exit(60)');
    // Nessuna conoscenza iniziale → nessuna ipotesi (mai silente: se non so, dico che non so).
    expect(store.hypothesize(exitSeq)).toBeNull();
    // Osservo la sequenza confermata in 3 binari distinti della famiglia malware-X.
    store.observe(exitSeq, 'exit(60)', 'binario-A', true);
    store.observe(exitSeq, 'exit(60)', 'binario-B', true);
    store.observe(exitSeq, 'exit(60)', 'binario-C', true);
    const hyp = store.hypothesize(exitSeq);
    expect(hyp).not.toBeNull();
    expect(hyp!.interpretation).toBe('exit(60)');
    expect(hyp!.supportingBinaries).toBe(3);
    // Confidence alta (3 conferme, 0 falsificazioni) ma NON 1.0 (Wilson score è conservativo).
    expect(hyp!.confidence).toBeGreaterThan(0.5);
    expect(hyp!.confidence).toBeLessThan(1.0);
    const conf3 = hyp!.confidence;
    // Aggiungo altre 7 conferme (totale 10 binari): la confidence cresce.
    for (let i = 0; i < 7; i++) {
      store.observe(exitSeq, 'exit(60)', `binario-${String.fromCharCode(68 + i)}`, true);
    }
    const hyp10 = store.hypothesize(exitSeq)!;
    expect(hyp10.supportingBinaries).toBe(10);
    expect(hyp10.confidence).toBeGreaterThan(conf3);
  });

  it('evita double-counting: lo stesso binario osservato più volte non gonfia la confidence', () => {
    const store = new AtomicKnowledgeStore();
    const seq = AtomicKnowledgeStore.buildSequence(['xor_reg_reg', 'xor_reg_reg'], 'clear eax');
    store.observe(seq, 'clear eax', 'binario-UNO', true);
    store.observe(seq, 'clear eax', 'binario-UNO', true); // stesso binario, ripetuto
    store.observe(seq, 'clear eax', 'binario-UNO', true);
    const hyp = store.hypothesize(seq)!;
    // Conta 1 binario distinto, non 3 osservazioni.
    expect(hyp.supportingBinaries).toBe(1);
    expect(store.getEntry(seq.sequenceHash)!.confirmed).toBe(1);
  });

  it('CONFORMAL: incertezza si allarga su corpus sottile (mitigazione rischio PRD §10 ipotesi fuorvianti)', () => {
    const store = new AtomicKnowledgeStore();
    const seq = AtomicKnowledgeStore.buildSequence(['mov_reg_imm', 'ret'], 'return imm');
    // Corpus sottile: 1 sola conferma.
    store.observe(seq, 'return imm', 'binario-X', true);
    const hypThin = store.hypothesize(seq)!;
    const widthThin = hypThin.uncertaintyInterval.upper - hypThin.uncertaintyInterval.lower;
    // Corpus robusto: 50 conferme su una sequenza diversa ma concettualmente simile.
    const seq2 = AtomicKnowledgeStore.buildSequence(['add_reg_reg', 'ret'], 'return sum');
    for (let i = 0; i < 50; i++) {
      store.observe(seq2, 'return sum', `binario-${i}`, true);
    }
    const hypThick = store.hypothesize(seq2)!;
    const widthThick = hypThick.uncertaintyInterval.upper - hypThick.uncertaintyInterval.lower;
    // L'intervallo sul corpus sottile è PIÙ LARGO di quello sul corpus robusto:
    // l'incertezza epistemica è onesta, mai nascosta.
    expect(widthThin).toBeGreaterThan(widthThick);
    // Entrambi gli intervalli sono dentro [0,1] e hanno coverage dichiarata.
    expect(hypThin.uncertaintyInterval.lower).toBeGreaterThanOrEqual(0);
    expect(hypThin.uncertaintyInterval.upper).toBeLessThanOrEqual(1);
    expect(hypThin.uncertaintyInterval.coverage).toBe(0.9);
  });

  it('meta-learning: una falsificazione riduce la confidence e allarga l\'incertezza', () => {
    const store = new AtomicKnowledgeStore();
    const seq = AtomicKnowledgeStore.buildSequence(['mov_reg_imm', 'syscall'], 'exit(60)');
    // 5 conferme.
    for (let i = 0; i < 5; i++) store.observe(seq, 'exit(60)', `b${i}`, true);
    const hypBefore = store.hypothesize(seq)!;
    // 2 falsificazioni: l'interpretazione "exit(60)" era sbagliata in 2 casi.
    store.observe(seq, 'exit(60)', 'b-falso-1', false);
    store.observe(seq, 'exit(60)', 'b-falso-2', false);
    const hypAfter = store.hypothesize(seq)!;
    // La confidence scende dopo le falsificazioni (meta-learning sugli errori).
    expect(hypAfter.confidence).toBeLessThan(hypBefore.confidence);
    // L'incertezza si allarga (falsification rate alta → intervallo più largo).
    const wBefore = hypBefore.uncertaintyInterval.upper - hypBefore.uncertaintyInterval.lower;
    const wAfter = hypAfter.uncertaintyInterval.upper - hypAfter.uncertaintyInterval.lower;
    expect(wAfter).toBeGreaterThan(wBefore);
  });

  it('metrics: accuracy cumulata e top sequenze per confidence (self-improvement loop B2)', () => {
    const store = new AtomicKnowledgeStore();
    const s1 = AtomicKnowledgeStore.buildSequence(['mov_reg_imm', 'syscall'], 'exit');
    const s2 = AtomicKnowledgeStore.buildSequence(['xor_reg_reg'], 'clear');
    store.observe(s1, 'exit', 'b1', true);
    store.observe(s1, 'exit', 'b2', true);
    store.observe(s2, 'clear', 'b3', true);
    store.observe(s2, 'clear', 'b4', false); // una falsificazione su s2
    const m = store.metrics();
    expect(m.sequences).toBe(2);
    expect(m.totalConfirmed).toBe(3);
    expect(m.totalFalsified).toBe(1);
    expect(m.accuracy).toBeCloseTo(3 / 4);
    // s1 (100% conferme) sta sopra s2 (50%) nella classifica top.
    expect(m.topSequences[0].mnemonic).toBe('exit');
  });

  it('persistenza: exportState/restoreState round-trip preserva conoscenza accumulata', () => {
    const store = new AtomicKnowledgeStore();
    const seq = AtomicKnowledgeStore.buildSequence(['mov_reg_imm', 'syscall'], 'exit(60)');
    store.observe(seq, 'exit(60)', 'b1', true);
    store.observe(seq, 'exit(60)', 'b2', true);
    const exported = store.exportState();
    // Nuovo store vuoto: ripristina dallo snapshot.
    const restored = new AtomicKnowledgeStore();
    expect(restored.size()).toBe(0);
    restored.restoreState(exported);
    expect(restored.size()).toBe(1);
    const hyp = restored.hypothesize(seq)!;
    expect(hyp.supportingBinaries).toBe(2);
    expect(hyp.interpretation).toBe('exit(60)');
  });
});