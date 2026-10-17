/**
 * Cognitive telemetry collector (PRD §3.2) — PRIVACY-FIRST.
 *
 * Il collector gira interamente nel browser: ascolta keystroke/mouse,
 * deriva due numeri (loadLevel, flowScore) e li consegna alla callback.
 * I segnali grezzi (timing dei tasti, campioni mouse) NON lasciano mai la
 * pagina: niente log, niente invii. Raccolta attiva solo con consenso
 * esplicito (l'App monta il collector solo dopo l'opt-in).
 *
 * Le formule sono proxy euristici dichiarati: varianza degli intervalli di
 * tastazione + velocità/entropia del mouse → carico; attività costante su
 * carico basso → flow. Eye-tracking (mediapipe) si innesterà sullo stesso
 * seam in iterazioni future.
 */

export interface DerivedCognitiveState {
  loadLevel: number;
  flowScore: number;
}

export interface CognitiveCollectorOptions {
  sessionId: string;
  /** Ogni quanto emettere uno stato derivato (default 15s). */
  intervalMs?: number;
  onState: (state: DerivedCognitiveState) => void;
}

const KEY_WINDOW = 40;
const MOUSE_WINDOW = 80;
const ACTIVITY_REFERENCE = 40;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class CognitiveCollector {
  private keyIntervals: number[] = [];
  private lastKeyTs = 0;
  private mouseDeltas: number[] = [];
  private directionReversals = 0;
  private lastDirection = 0;
  private lastMouse: { x: number; y: number; t: number } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private activityTicks = 0;

  constructor(private readonly options: CognitiveCollectorOptions) {}

  start(): void {
    document.addEventListener('keydown', this.handleKey);
    document.addEventListener('mousemove', this.handleMouse);
    this.timer = setInterval(this.emit, this.options.intervalMs ?? 15_000);
  }

  stop(): void {
    document.removeEventListener('keydown', this.handleKey);
    document.removeEventListener('mousemove', this.handleMouse);
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private handleKey = (): void => {
    const now = performance.now();
    if (this.lastKeyTs > 0) {
      this.keyIntervals.push(now - this.lastKeyTs);
      if (this.keyIntervals.length > KEY_WINDOW) this.keyIntervals.shift();
      this.activityTicks += 1;
    }
    this.lastKeyTs = now;
  };

  private handleMouse = (event: MouseEvent): void => {
    const now = performance.now();
    if (this.lastMouse) {
      const dx = event.clientX - this.lastMouse.x;
      const dy = event.clientY - this.lastMouse.y;
      const dt = Math.max(1, now - this.lastMouse.t);
      this.mouseDeltas.push(Math.hypot(dx, dy) / dt);
      if (this.mouseDeltas.length > MOUSE_WINDOW) this.mouseDeltas.shift();
      const direction = dx !== 0 ? Math.sign(dx) : this.lastDirection;
      if (this.lastDirection !== 0 && direction !== this.lastDirection) {
        this.directionReversals += 1;
      }
      this.lastDirection = direction;
      this.activityTicks += 1;
    }
    this.lastMouse = { x: event.clientX, y: event.clientY, t: now };
  };

  private emit = (): void => {
    const loadLevel = this.estimateLoad();
    const flowScore = this.estimateFlow(loadLevel);
    this.options.onState({ loadLevel, flowScore });
  };

  /** Carico: variabilità battitura (coefficiente di variazione) + caos mouse. */
  private estimateLoad(): number {
    let load = 0.25;
    if (this.keyIntervals.length >= 3) {
      const mean = this.keyIntervals.reduce((a, b) => a + b, 0) / this.keyIntervals.length;
      const variance =
        this.keyIntervals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / this.keyIntervals.length;
      const cv = Math.sqrt(variance) / Math.max(mean, 1);
      load += cv * 0.5 + clamp01((mean - 400) / 800) * 0.25;
    }
    if (this.mouseDeltas.length >= 5) {
      const mean = this.mouseDeltas.reduce((a, b) => a + b, 0) / this.mouseDeltas.length;
      const variance =
        this.mouseDeltas.reduce((acc, v) => acc + (v - mean) ** 2, 0) / this.mouseDeltas.length;
      const cv = Math.sqrt(variance) / Math.max(mean, 0.01);
      const reversals = this.directionReversals / Math.max(1, this.mouseDeltas.length);
      load += clamp01(cv) * 0.15 + clamp01(reversals) * 0.1;
    }
    return clamp01(load);
  }

  /** Flow: attività sostenuta su carico basso. */
  private estimateFlow(loadLevel: number): number {
    const activity = clamp01(this.activityTicks / ACTIVITY_REFERENCE);
    return clamp01((1 - loadLevel) * 0.7 + activity * 0.3);
  }
}
