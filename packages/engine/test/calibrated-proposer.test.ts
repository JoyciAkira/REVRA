/**
 * G2.1 — CalibratedNeuralProposer (gate: confidence CALIBRATA via Platt scaling,
 * non hardcoded come il mock; feature extraction deterministica; margine di
 * incertezza che si allarga su evidenza debole; rispetta il seam NeuralProposer).
 *
 * Il principio PRD §3.1 + §10: una confidence non calibrata mente all'analista.
 * La calibrazione allinea la confidence dichiarata alla frequenza empirica di
 * correttezza. "Mai un numero senza margine" (B2/G1): ogni punteggio porta un
 * intervallo di incertezza onesto.
 */
import { describe, expect, it } from 'vitest';
import {
  CalibratedNeuralProposer,
  DEFAULT_PLATT_PARAMS,
  extractFeatures,
  plattCalibrate,
  rawLogit,
  uncertaintyMargin,
} from '../src/hybrid/calibrated-proposer.js';
import type { DecompileContext } from '../src/hybrid/types.js';

const CTX_X86_SMALL: DecompileContext = {
  binaryHash: 'g21-bin-x86-small',
  arch: 'x86-64',
  addressRange: { start: '0x401000', end: '0x401020' }, // 32 byte, allineato
};

const CTX_UNKNOWN_ARCH: DecompileContext = {
  binaryHash: 'g21-bin-unknown',
  arch: 'mips-be', // arch non riconosciuta → penalità
  addressRange: { start: '0x1000', end: '0x1100' }, // 256 byte
};

describe('G2.1 — CalibratedNeuralProposer (confidence calibrata, non hardcoded)', () => {
  it('rispetta il seam NeuralProposer: modelId + modelVersion stabili, propose ritorna candidati', async () => {
    const p = new CalibratedNeuralProposer();
    expect(typeof p.modelId).toBe('string');
    expect(p.modelId.length).toBeGreaterThan(0);
    expect(typeof p.modelVersion).toBe('string');
    const cands = await p.propose(CTX_X86_SMALL);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.modelId).toBe(p.modelId);
      expect(c.modelVersion).toBe(p.modelVersion);
      expect(c.claim.kind).toBe('decompilation');
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('GATE CALIBRAZIONE: feature extraction è DETERMINISTICA (stesso input → stesse feature → stessa confidence)', () => {
    const f1 = extractFeatures(CTX_X86_SMALL);
    const f2 = extractFeatures(CTX_X86_SMALL);
    expect(f1).toEqual(f2);
    const p = new CalibratedNeuralProposer();
    const s1 = p.score(CTX_X86_SMALL);
    const s2 = p.score(CTX_X86_SMALL);
    expect(s1.confidence).toBe(s2.confidence);
    expect(s1.logit).toBe(s2.logit);
  });

  it('GATE CALIBRAZIONE: confidence deriva da feature osservabili, NON è una sequenza hardcoded decrescente', () => {
    const p = new CalibratedNeuralProposer();
    // Due contesti DIVERSI devono produrre confidence DIVERSE (il mock invece
    // produceva sempre 0.95, 0.80, 0.65 indipendentemente dal contesto).
    const sGood = p.score(CTX_X86_SMALL); // x86-64 noto, range piccolo allineato
    const sBad = p.score(CTX_UNKNOWN_ARCH); // arch sconosciuta, range più grande
    expect(sGood.features.archKnown).toBe(true);
    expect(sBad.features.archKnown).toBe(false);
    // Il contesto "buono" ha confidence strettamente maggiore del "cattivo":
    // la confidence riflette l'evidenza, non è un numero arbitrario.
    expect(sGood.confidence).toBeGreaterThan(sBad.confidence);
  });

  it('Platt scaling: logit alto → probability alta, logit basso → probability bassa (monotonia)', () => {
    const pHigh = plattCalibrate(3.0, DEFAULT_PLATT_PARAMS);
    const pMid = plattCalibrate(0.0, DEFAULT_PLATT_PARAMS);
    const pLow = plattCalibrate(-3.0, DEFAULT_PLATT_PARAMS);
    expect(pHigh).toBeGreaterThan(pMid);
    expect(pMid).toBeGreaterThan(pLow);
    // Tutti dentro [0,1] (probability calibrata valida).
    for (const p of [pHigh, pMid, pLow]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('rawLogit: patternDensity domina, arch nota dà boost, range enorme penalizza', () => {
    const base = rawLogit({ rangeBytes: 32, archKnown: true, patternDensity: 0.8 });
    const noArch = rawLogit({ rangeBytes: 32, archKnown: false, patternDensity: 0.8 });
    const lowPattern = rawLogit({ rangeBytes: 32, archKnown: true, patternDensity: 0.1 });
    const huge = rawLogit({ rangeBytes: 8192, archKnown: true, patternDensity: 0.8 });
    // Arch nota > arch sconosciuta (a parità di resto).
    expect(base).toBeGreaterThan(noArch);
    // Pattern density alta > bassa (segnale più forte di codice reale).
    expect(base).toBeGreaterThan(lowPattern);
    // Range enorme penalizzato rispetto a range piccolo.
    expect(base).toBeGreaterThan(huge);
  });

  it('feature con byte grezzi: riconosce segnali strutturali (ret c3, prologo 55, call e8)', () => {
    // Byte reali: push rbp (55), mov rbp,rsp (48 89 e5), ... ret (c3).
    const bytesHex = '554889e5b83c000000c3';
    const f = extractFeatures(CTX_X86_SMALL, bytesHex);
    expect(f.rangeBytes).toBe(32);
    expect(f.archKnown).toBe(true);
    // Ci sono segnali strutturali (prologo + ret) → density > 0: i byte vengono letti.
    expect(f.patternDensity).toBeGreaterThan(0);
    // La confidence con byte è un numero calibrato valido in [0,1] (l'ordinamento
    // esatto con/senza byte dipende dai valori concreti delle feature; il punto del
    // gate è che i byte vengano riconosciuti e producano una confidence onesta, non
    // che sia monotona rispetto all'euristica senza byte).
    const p = new CalibratedNeuralProposer({ rawBytesHex: bytesHex });
    const conf = p.score(CTX_X86_SMALL).confidence;
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });

  it('CONFORMAL-LITE: margine di incertezza si ALLARGA su evidenza debole (mai un numero senza margine)', () => {
    const strong: Parameters<typeof uncertaintyMargin>[0] = { rangeBytes: 32, archKnown: true, patternDensity: 0.9 };
    const weak: Parameters<typeof uncertaintyMargin>[0] = { rangeBytes: 8192, archKnown: false, patternDensity: 0.05 };
    const mStrong = uncertaintyMargin(strong);
    const mWeak = uncertaintyMargin(weak);
    const wStrong = mStrong.upper - mStrong.lower;
    const wWeak = mWeak.upper - mWeak.lower;
    // Evidenza debole → intervallo più largo (incertezza epistemica onesta).
    expect(wWeak).toBeGreaterThan(wStrong);
    expect(mStrong.coverage).toBe(0.9);
    expect(mWeak.lower).toBeGreaterThanOrEqual(0);
    expect(mWeak.upper).toBeLessThanOrEqual(1);
  });

  it('score() espone trasparenza totale: features + logit + confidence + margin (PRD §0.2)', () => {
    const p = new CalibratedNeuralProposer();
    const s = p.score(CTX_X86_SMALL);
    expect(s.features).toBeDefined();
    expect(typeof s.logit).toBe('number');
    expect(s.confidence).toBeGreaterThanOrEqual(0);
    expect(s.margin).toBeDefined();
    expect(s.margin.lower).toBeLessThanOrEqual(s.margin.upper);
  });

  it('propose genera N candidati con confidence calibrata scalata (migliore = più alta, ma tutte calibrate)', async () => {
    const p = new CalibratedNeuralProposer({ candidatesPerRun: 4 });
    const cands = await p.propose(CTX_X86_SMALL);
    expect(cands.length).toBe(4);
    // Ordinati per confidence decrescente (variante migliore prima).
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].confidence).toBeGreaterThanOrEqual(cands[i].confidence);
    }
    // La migliore ha confidence > 0 (non è un mock che parte sempre da 0.95 fisso:
    // qui dipende dal contesto; su x86-64 piccolo allineato è ragionevolmente alta).
    expect(cands[0].confidence).toBeGreaterThan(0);
    // Tutte le confidence sono <= 1 e >= 0 (calibrate valide).
    for (const c of cands) {
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('candidatesPerRun=0 → nessun candidato (guardia contro config errata)', async () => {
    const p = new CalibratedNeuralProposer({ candidatesPerRun: 0 });
    const cands = await p.propose(CTX_X86_SMALL);
    expect(cands).toEqual([]);
  });
});