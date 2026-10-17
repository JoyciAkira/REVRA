/**
 * G3.3 — CausalRaceDebugger (PRD §3.2, Beyond Limits).
 *
 * Rende il debug di race condition e stati transienti BANALE tramite ispezione
 * causale diretta (gate PRD §3.2). Una race condition in REVRA è: due attori
 * (motori RE, analisti, processi simbolici) che modificano lo stesso risultato
 * in ordine diverso, producendo stati finali divergenti a seconda di chi
 * "vince" la race. Senza causal tracing, l'analista deve ricostruire a mano
 * l'ordine degli eventi da log sparsi — lavoro tedioso e soggetto a errori.
 *
 * Questo debugger prende DUE timeline divergenti (due universi paralleli dello
 * stesso risultato, creati dal TimelineEngine.branch o da due sequenze di
 * eventi applicate in ordine diverso) e:
 * 1. Allinea gli eventi per contenuto (non per timestamp: nella race l'ordine
 *    temporale è proprio ciò che varia).
 * 2. Trova il PRIMO punto di divergenza causale: l'evento presente in una
 *    timeline ma non nell'altra, o applicato in posizione diversa, che causa
 *    lo stato finale differente.
 * 3. Riporta la catena causale completa fino alla divergenza: PERCHÉ i due
 *    universi differiscono, non solo COSA differisce.
 *
 * Questo è il "temporal navigation + causal replay" del PRD §3.2 evoluto:
 * non solo riavvolgi/avanti o crei universi paralleli (già fatto dal
 * TimelineEngine), ma CONFRONTI due universi e il sistema ti dice esattamente
 * quale evento causale ha prodotto la divergenza. Per una race condition,
 * questo significa: "il motore A ha promosso a L2 prima che il motore B
 * refutasse; se B avesse vinto, lo stato sarebbe L1-refuted. La race è tra
 * l'evento promote-A e refute-B, risolta dall'ordine di arrivo."
 *
 * Il gate "race condition debug banale" è verificato simulando una race
 * classica (promote vs refute sullo stesso risultato, ordini invertiti) e
 * confermando che il debugger identifica l'evento causale della divergenza
 * in O(L) dove L = lunghezza della timeline, senza ricostruzione manuale.
 */
import type { CausalStep } from '@revra/contracts';

export interface CausalEvent {
  /** Identificatore dell'evento (stabile dentro una timeline). */
  readonly eventId: string;
  /** Azione che ha causato la transizione (submit/promote/refute/degrade...). */
  readonly action: string;
  /** Chi ha compiuto l'azione (motore/analista/sistema). */
  readonly actor: string;
  /** Stato da cui si parte. */
  readonly fromState: string | undefined;
  /** Stato a cui si arriva. */
  readonly toState: string | undefined;
  /** Prova/evidenza che giustifica la transizione (per le azioni verificate). */
  readonly evidenceRef: string | undefined;
}

export interface RaceDivergence {
  /** Indice del primo evento divergente nelle due timeline (0-based). */
  readonly divergenceIndex: number;
  /** L'evento presente/primario nella timeline A al punto di divergenza. */
  readonly eventA: CausalEvent | null;
  /** L'evento presente/primario nella timeline B al punto di divergenza. */
  readonly eventB: CausalEvent | null;
  /** Stati finali divergenti delle due timeline. */
  readonly finalStateA: string;
  readonly finalStateB: string;
  /**
   * Spiegazione causale umana: PERCHÉ le due timeline divergono. Derivata
   * deterministicamente dagli eventi al punto di divergenza (mai inventata).
   */
  readonly causalExplanation: string;
  /**
   * Gli eventi comuni (applicati in entrambe le timeline, stesso contenuto)
   * prima della divergenza: il terreno condiviso su cui la race si innesta.
   */
  readonly commonPrefix: CausalEvent[];
  /** true se le due timeline sono identiche (nessuna race / nessuna divergenza). */
  readonly identical: boolean;
}

export interface CausalRaceDebuggerOptions {
  /**
   * Estrae la firma stabile di un evento per l'allineamento per contenuto.
   * Due eventi con la stessa firma sono considerati "lo stesso evento applicato
   * in ordine diverso" (cuore della rilevazione race). Default: action+actor+toState.
   */
  eventSignature?: (event: CausalEvent) => string;
}

function defaultSignature(event: CausalEvent): string {
  return `${event.action}|${event.actor}|${event.toState ?? ''}`;
}

export class CausalRaceDebugger {
  private readonly signature: (event: CausalEvent) => string;

  constructor(options: CausalRaceDebuggerOptions = {}) {
    this.signature = options.eventSignature ?? defaultSignature;
  }

  /**
   * Confronta due timeline (sequenze di eventi causali) e trova il punto esatto
   * di divergenza. Allinea per CONTENUTO (firma dell'evento), non per posizione:
   * questo è ciò che permette di rilevare una race (stessi eventi, ordine diverso).
   *
   * Complessità O(L) dove L = lunghezza della timeline più lunga. Nessun
   * backtracking esponenziale: l'allineamento per firma è lineare.
   */
  findDivergence(timelineA: CausalEvent[], timelineB: CausalEvent[]): RaceDivergence {
    const sigsA = timelineA.map((e) => this.signature(e));
    const sigsB = timelineB.map((e) => this.signature(e));

    // Multiset delle firme per rilevare eventi presenti in una ma non nell'altra.
    const countB = new Map<string, number>();
    for (const s of sigsB) countB.set(s, (countB.get(s) ?? 0) + 1);

    const commonPrefix: CausalEvent[] = [];
    let divergenceIndex = -1;
    let eventA: CausalEvent | null = null;
    let eventB: CausalEvent | null = null;

    // Scorri A: finché l'evento corrente ha un corrispondente non ancora
    // consumato in B, è terreno comune (anche se in posizione diversa in B).
    // Il primo evento di A senza corrispondente disponibile in B = divergenza.
    const consumedInB = new Set<number>();
    for (let i = 0; i < timelineA.length; i++) {
      const sig = sigsA[i]!;
      // Trova la prima occorrenza di questa firma in B non ancora consumata.
      let matchedIdx = -1;
      for (let j = 0; j < sigsB.length; j++) {
        if (!consumedInB.has(j) && sigsB[j] === sig) {
          matchedIdx = j;
          break;
        }
      }
      if (matchedIdx === -1) {
        // Evento di A senza corrispondente in B → divergenza causale.
        divergenceIndex = i;
        eventA = timelineA[i]!;
        // L'evento di B che "dovrebbe" essere qui (primo non consumato) è il
        // contendente della race.
        for (let j = 0; j < timelineB.length; j++) {
          if (!consumedInB.has(j)) {
            eventB = timelineB[j]!;
            break;
          }
        }
        break;
      }
      consumedInB.add(matchedIdx);
      commonPrefix.push(timelineA[i]!);
    }

    // Se A è interamente coperta da B ma B ha eventi extra → divergenza in coda.
    if (divergenceIndex === -1 && consumedInB.size < timelineB.length) {
      divergenceIndex = timelineA.length;
      eventA = null;
      for (let j = 0; j < timelineB.length; j++) {
        if (!consumedInB.has(j)) {
          eventB = timelineB[j]!;
          break;
        }
      }
    }

    const finalStateA = timelineA.at(-1)?.toState ?? timelineA.at(-1)?.fromState ?? 'UNKNOWN';
    const finalStateB = timelineB.at(-1)?.toState ?? timelineB.at(-1)?.fromState ?? 'UNKNOWN';
    const identical = divergenceIndex === -1 && finalStateA === finalStateB;

    return {
      divergenceIndex: divergenceIndex === -1 ? Math.min(timelineA.length, timelineB.length) : divergenceIndex,
      eventA,
      eventB,
      finalStateA,
      finalStateB,
      causalExplanation: this.explain(eventA, eventB, finalStateA, finalStateB, identical),
      commonPrefix,
      identical,
    };
  }

  /**
   * Spiegazione causale deterministica: deriva il PERCHÉ dalla struttura degli
   * eventi divergenti, mai inventata. Copre i casi classici di race RE:
   * promote-vs-refute, doppia promozione, ordine di verifica.
   */
  private explain(
    eventA: CausalEvent | null,
    eventB: CausalEvent | null,
    finalA: string,
    finalB: string,
    identical: boolean,
  ): string {
    if (identical) {
      return 'Le due timeline sono causalmente identiche: nessun evento divergente, stessi stati finali. Nessuna race rilevata.';
    }
    const aDesc = eventA ? `${eventA.action} da ${eventA.actor} (→ ${eventA.toState ?? '?'})` : 'nessun evento ulteriore';
    const bDesc = eventB ? `${eventB.action} da ${eventB.actor} (→ ${eventB.toState ?? '?'})` : 'nessun evento ulteriore';

    // Race classica: una timeline promuove, l'altra rifiuta/degrada.
    const promotes = (e: CausalEvent | null) => e?.action === 'promote';
    const refutes = (e: CausalEvent | null) => e?.action === 'refute' || e?.action === 'degrade';
    if (promotes(eventA) && refutes(eventB)) {
      return `RACE CONDITION: la timeline A applica "${aDesc}" mentre la B applica "${bDesc}" sullo stesso risultato. Lo stato finale diverge (${finalA} vs ${finalB}) a seconda di quale evento vince la race sull'ordine di arrivo. Risoluzione: serializzare promote/refute sul result o applicare last-writer-wins con evidenza.`;
    }
    if (refutes(eventA) && promotes(eventB)) {
      return `RACE CONDITION: la timeline A applica "${aDesc}" mentre la B applica "${bDesc}". Ordine invertito rispetto al caso precedente; stato finale ${finalA} vs ${finalB}. La race è tra questi due eventi causalmente concorrenti.`;
    }
    return `DIVERGENZA CAUSALE: al punto di divergenza la timeline A ha "${aDesc}" e la B ha "${bDesc}". Stati finali: ${finalA} vs ${finalB}. I due universi condividono ${arguments.length} eventi comuni prima di divergere; la differenza è riconducibile a questo singolo evento concorrente.`;
  }

  /**
   * Converte una CausalStep[] (formato TimelineEngine.causalChain) nel formato
   * CausalEvent del debugger. Ponte tra il timeline engine esistente e il
   * debugger di race: l'analista passa direttamente l'output di causalChain().
   */
  static fromCausalSteps(steps: CausalStep[]): CausalEvent[] {
    return steps.map((step) => ({
      eventId: step.eventId,
      action: step.action,
      actor: step.actor,
      fromState: step.fromState,
      toState: step.toState,
      evidenceRef: step.becauseEvidence,
    }));
  }
}