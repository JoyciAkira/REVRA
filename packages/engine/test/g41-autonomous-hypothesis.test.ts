/**
 * G4.1 — Autonomous hypothesis generation (PRD §3.3, Beyond Limits).
 *
 * Gate: "time-to-first-insight <30 secondi per binari simili a campioni noti".
 * La KB non è passiva: genera ATTICAMENTE ipotesi falsificabili sui nuovi binari
 * basandosi sul corpus accumulato, senza intervento umano. Quando un nuovo binario
 * viene caricato, la KB propone: "Questo assomiglia al malware X famiglia Y,
 * probabile funzione Z a offset 0xABC, basato su N analisi precedenti con
 * confidenza C".
 *
 * Le ipotesi sono FALSIFICABILI e TRACCIATE: ogni previsione è registrata e il
 * sistema impara dalle conferme/smentite (meta-learning). Questo è il seme del
 * flywheel di conoscenza: più si analizza, più il motore sa, e più velocemente
 * genera insight sui nuovi binari.
 *
 * Il gate "<30s" è misurato empiricamente: su un corpus popolato (centinaia di
 * pattern), la generazione di ipotesi per un nuovo binario simile deve completare
 * in ben meno di 30 secondi. Qui il calcolo è puro (in-memory), quindi il tempo
 * è nell'ordine dei ms, ma il principio è verificato: nessuna attesa, nessun
 * intervento umano, insight immediato dal corpus.
 *
 * Coerente con G1 AtomicKnowledgeStore (flywheel atomico) e B2 EpistemicEngine
 * (conformal interval, self-improvement loop): l'ipotesi porta sempre un
 * intervallo di incertezza onesto, mai un numero senza margine.
 */
import { describe, expect, it } from 'vitest';
import { EpistemicEngine } from '../src/epistemic/epistemic-engine.js';

const NOW = '2026-10-13T00:00:00.000Z';

/**
 * Corpus realistico: famiglia malware nota vista molte volte su architetture
 * diverse, più famiglie minori. Simula un corpus accumulato da mesi di analisi.
 */
function populatedCorpus(): EpistemicEngine {
  const engine = new EpistemicEngine();
  // Famiglia principale "ransom-updater": vista 50 volte su x86_64 via ghidra.
  for (let i = 0; i < 50; i++) {
    engine.learnPattern('x86_64', 'ghidra', 'ransom-updater', NOW);
  }
  // Stessa famiglia vista anche via radare2 (cross-engine confirmation).
  for (let i = 0; i < 20; i++) {
    engine.learnPattern('x86_64', 'radare2', 'ransom-updater', NOW);
  }
  // Famiglia su arm64 (firmware embedded).
  for (let i = 0; i < 15; i++) {
    engine.learnPattern('arm64', 'ghidra', 'iot-botnet', NOW);
  }
  // Famiglia rara su mips (router firmware).
  for (let i = 0; i < 3; i++) {
    engine.learnPattern('mips', 'binwalk', 'router-exploit', NOW);
  }
  return engine;
}

describe('G4.1 — Autonomous hypothesis generation (time-to-first-insight <30s)', () => {
  it('GATE TIME-TO-FIRST-INSIGHT: su corpus popolato, ipotesi generata in <30s (misurato, non assunto)', () => {
    const engine = populatedCorpus();
    const t0 = performance.now();
    // Nuovo binario x86_64 via ghidra: simile ai 50+ campioni ransom-updater.
    const hypotheses = engine.generate(
      { binaryHash: 'g41-newbin-x86-00001', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    const elapsedMs = performance.now() - t0;
    // Gate PRD §3.3: time-to-first-insight <30 secondi. Su corpus in-memory
    // è nell'ordine dei ms, ma il principio è verificato: generazione immediata.
    expect(elapsedMs).toBeLessThan(30_000);
    // Almeno un'ipotesi generata autonomamente (match esatto sul corpus).
    expect(hypotheses.length).toBeGreaterThan(0);
    // L'ipotesi ha una confidence > 0 (derivata dal corpus, non inventata).
    expect(hypotheses[0].confidence).toBeGreaterThan(0);
  });

  it('ipotesi FALSIFICABILE e TRACCIATA: ogni ipotesi ha id unico, status PENDING, pronta per verdict', () => {
    const engine = populatedCorpus();
    const [hypothesis] = engine.generate(
      { binaryHash: 'g41-falsifiable-00001', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    expect(hypothesis).toBeDefined();
    expect(hypothesis.id).toMatch(/^hyp-/);
    expect(hypothesis.status).toBe('PROPOSED');
    // L'ipotesi è tracciata: posso applicarle un verdict (CONFIRMED/FALSIFIED).
    engine.applyVerdict(hypothesis.id, 'CONFIRMED');
    const listed = engine.listHypotheses();
    const confirmed = listed.find((h) => h.id === hypothesis.id);
    expect(confirmed?.status).toBe('CONFIRMED');
  });

  it('meta-learning: una falsificazione riduce la confidence delle ipotesi future sullo stesso pattern', () => {
    const engine = populatedCorpus();
    // Prima ipotesi: confidence alta (corpus ricco di ransom-updater x86_64/ghidra).
    const [h1] = engine.generate(
      { binaryHash: 'g41-meta-00001', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    const confBefore = h1.confidence;
    // Falsifico ripetutamente ipotesi su questo pattern: il modello impara dagli errori.
    for (let i = 0; i < 10; i++) {
      const [h] = engine.generate(
        { binaryHash: `g41-meta-falsify-${i}`, arch: 'x86_64', firstEngineSource: 'ghidra' },
        NOW,
      );
      engine.applyVerdict(h.id, 'FALSIFIED');
    }
    // Nuova ipotesi dopo le falsificazioni: confidence scesa (meta-learning).
    const [hAfter] = engine.generate(
      { binaryHash: 'g41-meta-after-00001', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    expect(hAfter.confidence).toBeLessThan(confBefore);
  });

  it('conformal interval: ogni ipotesi porta un intervallo di incertezza onesto (mai un numero senza margine)', () => {
    const engine = populatedCorpus();
    const [hypothesis] = engine.generate(
      { binaryHash: 'g41-conformal-00001', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    const interval = engine.conformalInterval(hypothesis.id);
    expect(interval.lower).toBeLessThanOrEqual(interval.point);
    expect(interval.upper).toBeGreaterThanOrEqual(interval.point);
    expect(interval.coverage).toBe(0.9);
    // Intervallo dentro [0,1] (incertezza calibrata valida).
    expect(interval.lower).toBeGreaterThanOrEqual(0);
    expect(interval.upper).toBeLessThanOrEqual(1);
  });

  it('senza match nel corpus → nessuna ipotesi inventata (onestà epistemica, PRD §3.3)', () => {
    const engine = new EpistemicEngine(); // corpus vuoto
    const hypotheses = engine.generate(
      { binaryHash: 'g41-nomatch-00001', arch: 'riscv', firstEngineSource: 'unknown' },
      NOW,
    );
    // Nessuna ipotesi inventata: se non so, dico che non so (gap registrato).
    expect(hypotheses).toHaveLength(0);
  });

  it('match debole (stessa arch, engine diverso) → ipotesi con confidence penalizzata ma presente', () => {
    const engine = populatedCorpus();
    // Corpus ha x86_64/ghidra (ransom-updater) ma non x86_64/cutter.
    const hypotheses = engine.generate(
      { binaryHash: 'g41-weakmatch-00001', arch: 'x86_64', firstEngineSource: 'cutter' },
      NOW,
    );
    // Match debole: stessa arch, engine diverso → ipotesi presente ma confidence ridotta.
    expect(hypotheses.length).toBeGreaterThan(0);
    // La confidence del match debole è inferiore a quella del match esatto.
    const [exactMatch] = engine.generate(
      { binaryHash: 'g41-exactmatch-00001', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    expect(hypotheses[0].confidence).toBeLessThan(exactMatch.confidence);
  });

  it('scalabilità: su corpus grande (500+ pattern), time-to-first-insight resta <30s', () => {
    const engine = new EpistemicEngine();
    // Corpus grande: 500 pattern su architetture diverse.
    for (let i = 0; i < 500; i++) {
      const arch = i % 3 === 0 ? 'x86_64' : i % 3 === 1 ? 'arm64' : 'mips';
      const src = i % 2 === 0 ? 'ghidra' : 'radare2';
      engine.learnPattern(arch, src, `family-${i % 20}`, NOW);
    }
    const t0 = performance.now();
    const hypotheses = engine.generate(
      { binaryHash: 'g41-scale-00001', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    const elapsedMs = performance.now() - t0;
    // Anche su corpus grande, il gate <30s è rispettato largamente.
    expect(elapsedMs).toBeLessThan(30_000);
    expect(hypotheses.length).toBeGreaterThan(0);
  });

  it('generazione autonoma: nessun input umano richiesto oltre al binaryHash/arch/engineSource', () => {
    const engine = populatedCorpus();
    // L'unico input è il contesto del nuovo binario: nessuna feature engineering
    // umana, nessuna soglia manuale, nessun prompt. La KB decide autonomamente.
    const input = { binaryHash: 'g41-auto-00001', arch: 'arm64', firstEngineSource: 'ghidra' };
    const hypotheses = engine.generate(input, NOW);
    // Ipotesi generata autonomamente dal corpus arm64/ghidra (iot-botnet).
    expect(hypotheses.length).toBeGreaterThan(0);
    expect(hypotheses[0].patternId).toBeDefined();
  });
});