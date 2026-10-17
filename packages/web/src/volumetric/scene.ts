/**
 * Scena volumetrica (PRD §3.2): mappa pura e deterministica da risultati a
 * punti 3D — x = indirizzo (ordine), y = livello di evidenza, z = tempo
 * (ordine di arrivo), intensità = solidità dell'evidenza. Nessuna dipendenza
 * DOM/GPU: testabile in Node.
 */
import type { AnalysisResult } from '@revra/contracts';

export interface VolumePoint {
  /** [0,1] posizione lungo lo spazio degli indirizzi. */
  x: number;
  /** Livello di evidenza su asse verticale (L0=0 … L3=3; stati speciali intermedi). */
  y: number;
  /** [0,1] posizione temporale. */
  z: number;
  /** [0,1] solidità dell'evidenza (opacità/intensità di rendering). */
  intensity: number;
  resultId: string;
  state: string;
}

const LEVEL_Y: Record<string, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  DISPUTED: 2.5,
  UNKNOWN: 1.5,
  UNSUPPORTED: 0.5,
};

export function buildScene(results: AnalysisResult[]): VolumePoint[] {
  const sorted = [...results].sort(
    (a, b) => Number(a.addressRange.start) - Number(b.addressRange.start),
  );
  const n = sorted.length;
  return sorted.map((result, i) => {
    const firstTs = result.provenance[0]?.ts ?? '';
    const timeOrder = [...results]
      .map((r) => r.provenance[0]?.ts ?? '')
      .sort()
      .indexOf(firstTs);
    return {
      x: n > 1 ? i / (n - 1) : 0.5,
      y: LEVEL_Y[result.verification.state] ?? LEVEL_Y.UNKNOWN,
      z: n > 1 ? timeOrder / (n - 1) : 0.5,
      intensity: result.verification.state === 'L2' || result.verification.state === 'L3' ? 1 : 0.45,
      resultId: result.id,
      state: result.verification.state,
    };
  });
}
