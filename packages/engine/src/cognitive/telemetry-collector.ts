/**
 * G3.1 — CognitiveTelemetryCollector (PRD §3.2, Beyond Limits).
 *
 * Deriva il carico cognitivo (loadLevel) e lo stato di flow (flowScore) da
 * segnali comportamentali osservabili NON invasivi: keystroke dynamics (ritmo e
 * regolarità della digitazione) e mouse entropy (imprevedibilità del movimento).
 * Questi sono proxy validati in letteratura HCI per il carico mentale, e hanno
 * un vantaggio cruciale rispetto a eye-tracking hardware: funzionano su qualsiasi
 * browser, senza dispositivi dedicati, e sono calcolabili localmente.
 *
 * PRIVACY-FIRST (PRD §3.2 + §10 risk "telemetria percepita come sorveglianza"):
 * - OPT-IN ESPLICITO: il collettore è INATTIVO di default. Niente viene misurato
 *   finché l'analista non acconsente esplicitamente (consent()). Senza consenso,
 *   ogni metodo di ingestione è un no-op e score() ritorna un sample neutro.
 * - SOLO SEGNALI DERIVATI: il collettore non conserva MAI i raw event (timestamp
 *   esatti dei tasti, coordinate mouse precise). Accumula solo statistiche
 *   aggregate (intervalli tra tasti, entropia del movimento) in finestre
 *   scorrevoli, e produce un CognitiveSample [0,1]. I raw signal non lasciano
 *   mai il processo locale (coerente con CognitiveStateStore che registra solo
 *   stati derivati, mai segnali grezzi).
 * - REVOCA IMMEDIATA: revoke() ferma la raccolta e cancella le statistiche
 *   accumulate. L'analista ha controllo totale.
 *
 * Perché questo riduce il tempo di analisi del 40% (gate PRD §3.2): il
 * CognitiveSample prodotto alimenta l'AdaptivePolicy esistente, che semplifica
 * l'UI sotto alto carico (meno distrazioni quando l'analista è in difficoltà) ed
 * espande il dettaglio in flow state (più informazione quando l'analista è
 * produttivo). L'adattamento misurato al carico è il meccanismo che produce il
 * risparmio di tempo; qui forniamo il segnale onesto e privacy-respecting che lo
 * guida. Il gate "40%" è verificato nel test benchmark confrontando task completati
 * con vs senza adattamento guidato da questo segnale.
 *
 * Keystroke dynamics → loadLevel: digitazione irregolare (alta varianza negli
 * intervalli tra tasti, pause lunghe, molti backspace/correzioni) = alto carico
 * cognitivo (l'analista sta lottando col codice). Ritmo regolare e fluido = basso
 * carico.
 *
 * Mouse entropy → flowScore: movimento del mouse prevedibile e mirato (bassa
 * entropia, traiettorie dirette verso target) = flow state (l'analista sa cosa
 * fare). Movimento erratico/esplorativo (alta entropia) = non-flow (ricerca,
 * confusione). Nota: qui "flow" = bassa entropia mirata, quindi flowScore è
 * inversamente correlato all'entropia grezza.
 */
import type { CognitiveSample } from './types.js';

/** Evento di tasto normalizzato (solo ciò che serve, mai il carattere digitato). */
export interface KeystrokeEvent {
  /** Timestamp in ms (monotonico, solo per calcolare intervalli; non conservato). */
  ts: number;
  /** true se è una correzione (Backspace/Delete/Cancella) — segnale di difficoltà. */
  isCorrection: boolean;
}

/** Evento di movimento mouse normalizzato (delta, mai coordinate assolute). */
export interface MouseMoveEvent {
  ts: number;
  /** Delta di movimento dall'ultimo campione (dx, dy). Coordinate assolute mai usate. */
  dx: number;
  dy: number;
}

/** Statistiche aggregate in una finestra scorrevole (ciò che realmente conserviamo). */
interface WindowStats {
  /** Intervalli tra tasti consecutivi (ms) nella finestra. */
  keyIntervals: number[];
  /** Numero di correzioni (backspace) nella finestra. */
  corrections: number;
  /** Entropia stimata del movimento mouse nella finestra (Shannon su bucket di direzione). */
  mouseEntropy: number;
  /** Timestamp dell'ultimo evento (per scadere la finestra). */
  lastEventTs: number;
}

export interface TelemetryCollectorOptions {
  /** Dimensione della finestra scorrevole in numero di eventi tasto (default 20). */
  keyWindowSize?: number;
  /** Soglia di entropia mouse sopra la quale si considera "non-flow" (default 2.5 bit). */
  flowEntropyThreshold?: number;
  /** Carico massimo attribuito alle correzioni (default 0.4 di load aggiuntivo). */
  correctionLoadWeight?: number;
  /** Ora corrente in ms (iniettabile per test deterministici). */
  now?: () => number;
}

/** Sample neutro restituito quando il collettore è inattivo (no consent). */
const NEUTRAL_SAMPLE: CognitiveSample = { loadLevel: 0.5, flowScore: 0.5 };

export class CognitiveTelemetryCollector {
  private consented = false;
  private readonly keyWindowSize: number;
  private readonly flowEntropyThreshold: number;
  private readonly correctionLoadWeight: number;
  private readonly now: () => number;
  private stats: WindowStats = {
    keyIntervals: [],
    corrections: 0,
    mouseEntropy: 0,
    lastEventTs: 0,
  };
  /** Bucket di direzione del mouse per stima entropia Shannon (8 ottanti). */
  private directionBuckets: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private dirTotal = 0;
  private lastKeyTs: number | null = null;

  constructor(options: TelemetryCollectorOptions = {}) {
    this.keyWindowSize = options.keyWindowSize ?? 20;
    this.flowEntropyThreshold = options.flowEntropyThreshold ?? 2.5;
    this.correctionLoadWeight = options.correctionLoadWeight ?? 0.4;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Opt-in esplicito. Senza questa chiamata, il collettore è inattivo e non
   * misura nulla (privacy-first, PRD §3.2). Ritorna lo stato di consenso.
   */
  consent(): boolean {
    this.consented = true;
    return this.consented;
  }

  /** Revoca il consenso: ferma la raccolta e cancella le statistiche accumulate. */
  revoke(): void {
    this.consented = false;
    this.stats = { keyIntervals: [], corrections: 0, mouseEntropy: 0, lastEventTs: 0 };
    this.directionBuckets = [0, 0, 0, 0, 0, 0, 0, 0];
    this.dirTotal = 0;
    this.lastKeyTs = null;
  }

  /** Stato di consenso corrente (trasparenza per l'UI: mostra "telemetria attiva/disattiva"). */
  hasConsent(): boolean {
    return this.consented;
  }

  /**
   * Ingestione evento tasto. No-op se non c'è consenso. Non conserva il tasto
   * premuto né il timestamp assoluto: solo l'intervallo dal tasto precedente e
   * se è una correzione.
   */
  recordKeystroke(event: KeystrokeEvent): void {
    if (!this.consented) return;
    if (this.lastKeyTs !== null) {
      const interval = Math.max(0, event.ts - this.lastKeyTs);
      this.stats.keyIntervals.push(interval);
      if (this.stats.keyIntervals.length > this.keyWindowSize) {
        this.stats.keyIntervals.shift();
      }
    }
    if (event.isCorrection) this.stats.corrections += 1;
    this.lastKeyTs = event.ts;
    this.stats.lastEventTs = event.ts;
  }

  /**
   * Ingestione movimento mouse. No-op se non c'è consenso. Non conserva
   * coordinate assolute: solo il delta (dx, dy) per stimare l'entropia della
   * direzione del movimento.
   */
  recordMouseMove(event: MouseMoveEvent): void {
    if (!this.consented) return;
    // Bucket di direzione (8 ottanti) dal delta — nessuna coordinata assoluta.
    if (event.dx !== 0 || event.dy !== 0) {
      const angle = Math.atan2(event.dy, event.dx); // [-π, π]
      const octant = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 8) % 8;
      this.directionBuckets[octant] = (this.directionBuckets[octant] ?? 0) + 1;
      this.dirTotal += 1;
      this.stats.mouseEntropy = this.shannonEntropy();
    }
    this.stats.lastEventTs = event.ts;
  }

  /**
   * Produce il CognitiveSample corrente. Se non c'è consenso, ritorna il sample
   * neutro (0.5/0.5) — mai un valore che finga di aver misurato qualcosa senza
   * autorizzazione (coerente con "mai silente" PRD §0.2).
   *
   * loadLevel: alta varianza negli intervalli tra tasti + molte correzioni = alto
   * carico. Normalizzato in [0,1].
   * flowScore: bassa entropia del mouse (movimento mirato) = alto flow.
   * Normalizzato in [0,1], inversamente proporzionale all'entropia.
   */
  score(): CognitiveSample {
    if (!this.consented) return { ...NEUTRAL_SAMPLE };

    const loadLevel = this.computeLoad();
    const flowScore = this.computeFlow();
    return {
      loadLevel: Math.min(1, Math.max(0, loadLevel)),
      flowScore: Math.min(1, Math.max(0, flowScore)),
    };
  }

  /**
   * Coefficiente di variazione degli intervalli tra tasti (std/mean): misura
   * l'irregolarità della digitazione. Alto = carico cognitivo alto.
   * Combinato col tasso di correzioni (backspace) pesato.
   */
  private computeLoad(): number {
    const intervals = this.stats.keyIntervals;
    let irregularity = 0;
    if (intervals.length >= 2) {
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (mean > 0) {
        const variance =
          intervals.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / intervals.length;
        const std = Math.sqrt(variance);
        // Coefficiente di variazione, saturato: CV > 1.5 ≈ carico massimo.
        irregularity = Math.min(1, std / mean / 1.5);
      }
    }
    // Tasso di correzioni: correzioni / (intervalli + 1), pesato.
    const correctionRate =
      intervals.length > 0
        ? Math.min(1, this.stats.corrections / (intervals.length + 1))
        : 0;
    return Math.min(1, 0.6 * irregularity + this.correctionLoadWeight * correctionRate);
  }

  /**
   * Flow score: inversamente proporzionale all'entropia del mouse. Entropia
   * massima per 8 bucket uniformi = log2(8) = 3 bit. Sotto la soglia → flow.
   * Pochi/no dati mouse → flow neutro-alto (non penalizziamo l'assenza di mouse).
   */
  private computeFlow(): number {
    if (this.dirTotal < 4) return 0.6; // pochi dati: non inferiamo non-flow
    const maxEntropy = Math.log2(8); // 3 bit
    const normalizedEntropy = this.stats.mouseEntropy / maxEntropy; // [0,1]
    // Sotto soglia di entropia → flow alto; sopra → flow basso.
    const thresholdNorm = this.flowEntropyThreshold / maxEntropy;
    if (normalizedEntropy <= thresholdNorm) {
      return Math.min(1, 0.7 + 0.3 * (1 - normalizedEntropy / thresholdNorm));
    }
    return Math.max(0, 0.7 - 0.7 * ((normalizedEntropy - thresholdNorm) / (1 - thresholdNorm)));
  }

  /** Entropia di Shannon (bit) sulla distribuzione delle direzioni del mouse. */
  private shannonEntropy(): number {
    if (this.dirTotal === 0) return 0;
    let h = 0;
    for (const count of this.directionBuckets) {
      if (count > 0) {
        const p = count / this.dirTotal;
        h -= p * Math.log2(p);
      }
    }
    return h;
  }

  /**
   * Diagnostica trasparente (PRD §0.2): espone perché il sample ha questi valori,
   * senza esporre raw signal. Usato dall'UI per mostrare "carico alto perché
   * digitazione irregolare + 5 correzioni".
   */
  explain(): {
    consented: boolean;
    keySamples: number;
    corrections: number;
    mouseEntropyBits: number;
    loadLevel: number;
    flowScore: number;
  } {
    const s = this.score();
    return {
      consented: this.consented,
      keySamples: this.stats.keyIntervals.length,
      corrections: this.stats.corrections,
      mouseEntropyBits: Number(this.stats.mouseEntropy.toFixed(3)),
      loadLevel: s.loadLevel,
      flowScore: s.flowScore,
    };
  }
}