/**
 * ResultRecord: struttura interna del kernel (stato corrente + history
 * append-only). Estratta qui per essere referenziata dallo schema di
 * persistenza senza esporre l'implementazione.
 */
import type { AnalysisResult, ProvenanceEvent } from '@revra/contracts';

export interface ResultRecord {
  current: AnalysisResult;
  history: ProvenanceEvent[];
}
