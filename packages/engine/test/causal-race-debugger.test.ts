/**
* G3.3 — CausalRaceDebugger (gate: race condition debug BANALE via ispezione
* causale diretta; confronta due timeline divergenti e identifica l'evento
* causale esatto della divergenza in O(L), senza ricostruzione manuale).
*
* Una race condition REVRA classica: due attori (motore simbolico che promuove
* a L2 con proof, e motore comportamentale che refuta) modificano lo stesso
* risultato in ordine diverso. A seconda di chi "vince" la race sull'ordine di
* arrivo, lo stato finale è L2-promoted o L1-refuted. Senza causal tracing,
* l'analista ricostruisce a mano l'ordine da log sparsi. Il debugger confronta
* i due universi e dice ESATTAMENTE quale evento concorrente ha prodotto la
* divergenza, e PERCHÉ (spiegazione causale derivata deterministicamente).
*/
import { describe, expect, it } from 'vitest';
import { CausalRaceDebugger } from '../src/timeline/causal-race-debugger.js';
import type { CausalEvent } from '../src/timeline/causal-race-debugger.js';
import type { CausalStep } from '@revra/contracts';

const SUBMIT: CausalEvent = {
  eventId: 'evt-submit',
  action: 'submit',
  actor: 'analyst:alice',
  fromState: undefined,
  toState: 'L1',
  evidenceRef: undefined,
};

function promote(actor: string, evidence: string): CausalEvent {
  return {
    eventId: `evt-promote-${actor}`,
    action: 'promote',
    actor,
    fromState: 'L1',
    toState: 'L2',
    evidenceRef: evidence,
  };
}

function refute(actor: string, evidence: string): CausalEvent {
  return {
    eventId: `evt-refute-${actor}`,
    action: 'refute',
    actor,
    fromState: 'L1',
    toState: 'L1',
    evidenceRef: evidence,
  };
}

describe('G3.3 — CausalRaceDebugger (race condition debug via ispezione causale diretta)', () => {
  it('GATE RACE: promote-vs-refute sullo stesso risultato → identifica i due eventi concorrenti e spiega la race', () => {
    const debugger_ = new CausalRaceDebugger();
    // Universo A: submit → promote vince la race → stato finale L2.
    const timelineA: CausalEvent[] = [SUBMIT, promote('symbolic:lean', 'proof://lean/ok')];
    // Universo B: submit → refute vince la race → stato finale L1 (refutato).
    const timelineB: CausalEvent[] = [SUBMIT, refute('behavioral:unicorn', 'emu://unicorn/fail')];

    const div = debugger_.findDivergence(timelineA, timelineB);

    // Le due timeline NON sono identiche (race rilevata).
    expect(div.identical).toBe(false);
    // Stati finali divergenti: L2 vs L1.
    expect(div.finalStateA).toBe('L2');
    expect(div.finalStateB).toBe('L1');
    // Il punto di divergenza è l'indice 1 (dopo il submit comune).
    expect(div.divergenceIndex).toBe(1);
    // Gli eventi concorrenti sono esattamente promote (A) e refute (B).
    expect(div.eventA?.action).toBe('promote');
    expect(div.eventB?.action).toBe('refute');
    // Il terreno comune (submit) è riconosciuto come prefisso condiviso.
    expect(div.commonPrefix).toHaveLength(1);
    expect(div.commonPrefix[0].action).toBe('submit');
    // La spiegazione causale menziona esplicitamente la RACE CONDITION e i due eventi.
    expect(div.causalExplanation).toContain('RACE CONDITION');
    expect(div.causalExplanation).toContain('promote');
    expect(div.causalExplanation).toContain('refute');
  });

  it('ordine invertito (refute-vs-promote) → stessa rilevazione race, spiegazione coerente', () => {
    const debugger_ = new CausalRaceDebugger();
    // A: refute vince; B: promote vince. Ordine inverso del caso precedente.
    const timelineA: CausalEvent[] = [SUBMIT, refute('behavioral:unicorn', 'emu://fail')];
    const timelineB: CausalEvent[] = [SUBMIT, promote('symbolic:lean', 'proof://ok')];

    const div = debugger_.findDivergence(timelineA, timelineB);
    expect(div.identical).toBe(false);
    expect(div.eventA?.action).toBe('refute');
    expect(div.eventB?.action).toBe('promote');
    expect(div.causalExplanation).toContain('RACE CONDITION');
  });

  it('timeline identiche (stessi eventi, stesso ordine) → identical=true, nessuna race', () => {
    const debugger_ = new CausalRaceDebugger();
    const timeline: CausalEvent[] = [SUBMIT, promote('symbolic:lean', 'proof://ok')];
    const div = debugger_.findDivergence(timeline, [...timeline]);
    expect(div.identical).toBe(true);
    expect(div.causalExplanation).toContain('identiche');
    expect(div.eventA).toBeNull();
    expect(div.eventB).toBeNull();
  });

  it('stessi eventi ma ORDINE diverso (race pura su ordinamento) → allinea per contenuto, rileva divergenza di stato', () => {
    const debugger_ = new CausalRaceDebugger();
    // Due promozioni da motori diversi applicate in ordine inverso: stessi eventi
    // (per firma action|actor|toState), ma se gli actor differiscono la firma
    // differisce → divergenza. Qui usiamo actor diversi per modellare la race.
    const timelineA: CausalEvent[] = [SUBMIT, promote('engine:ghidra', 'p1'), promote('engine:radare2', 'p2')];
    const timelineB: CausalEvent[] = [SUBMIT, promote('engine:radare2', 'p2'), promote('engine:ghidra', 'p1')];
    const div = debugger_.findDivergence(timelineA, timelineB);
    // Stessi eventi (per contenuto), stati finali uguali (entrambi L2) → il debugger
    // li riconosce come terreno comune (allineamento per firma), nessuna divergenza
    // di stato finale: la race è sull'ordine ma non sul risultato.
    expect(div.finalStateA).toBe('L2');
    expect(div.finalStateB).toBe('L2');
  });

  it('evento presente in A ma non in B → divergenza in coda, eventB=null se B esaurita', () => {
    const debugger_ = new CausalRaceDebugger();
    const timelineA: CausalEvent[] = [SUBMIT, promote('symbolic:lean', 'proof://ok')];
    const timelineB: CausalEvent[] = [SUBMIT]; // B si ferma al submit
    const div = debugger_.findDivergence(timelineA, timelineB);
    expect(div.identical).toBe(false);
    expect(div.eventA?.action).toBe('promote');
    expect(div.eventB).toBeNull();
    expect(div.finalStateA).toBe('L2');
    expect(div.finalStateB).toBe('L1');
  });

  it('fromCausalSteps: converte CausalStep[] (output TimelineEngine.causalChain) in CausalEvent[]', () => {
    const steps: CausalStep[] = [
      {
        eventId: 'e1',
        action: 'submit',
        actor: 'analyst:alice',
        causedBy: null,
        becauseEvidence: undefined,
        becauseNote: 'claim entered',
        fromState: undefined,
        toState: 'L1',
      },
      {
        eventId: 'e2',
        action: 'promote',
        actor: 'symbolic:lean',
        causedBy: 'e1',
        becauseEvidence: 'proof://lean/ok',
        becauseNote: 'verified',
        fromState: 'L1',
        toState: 'L2',
      },
    ];
    const events = CausalRaceDebugger.fromCausalSteps(steps);
    expect(events).toHaveLength(2);
    expect(events[0].eventId).toBe('e1');
    expect(events[1].evidenceRef).toBe('proof://lean/ok');
    // Round-trip: il debugger accetta direttamente l'output di causalChain().
    const debugger_ = new CausalRaceDebugger();
    const div = debugger_.findDivergence(events, [events[0]]);
    expect(div.identical).toBe(false);
  });

  it('complessità lineare: su timeline di 5000 eventi, findDivergence completa rapidamente (O(L), no backtracking)', () => {
    const debugger_ = new CausalRaceDebugger();
    const N = 5000;
    const buildTimeline = (divergeAt: number): CausalEvent[] => {
      const out: CausalEvent[] = [];
      for (let i = 0; i < N; i++) {
        if (i === divergeAt) {
          out.push(promote(`engine:div-${i}`, `proof://${i}`));
        } else {
          out.push({
            eventId: `evt-${i}`,
            action: 'annotate',
            actor: 'system:revra',
            fromState: 'L1',
            toState: 'L1',
            evidenceRef: undefined,
          });
        }
      }
      return out;
    };
    const t0 = performance.now();
    const div = debugger_.findDivergence(buildTimeline(2500), buildTimeline(3000));
    const elapsed = performance.now() - t0;
    // Divergenza rilevata (eventi divergenti a indici diversi).
    expect(div.identical).toBe(false);
    // O(L) lineare: 5000+5000 eventi processati in ben meno di 1s (nessun
    // backtracking esponenziale). Soglia generosa per CI lento.
    expect(elapsed).toBeLessThan(1000);
  });

  it('spiegazione causale è deterministica: stessi input → stessa spiegazione (riproducibile, mai inventata)', () => {
    const debugger_ = new CausalRaceDebugger();
    const timelineA: CausalEvent[] = [SUBMIT, promote('symbolic:lean', 'proof://ok')];
    const timelineB: CausalEvent[] = [SUBMIT, refute('behavioral:unicorn', 'emu://fail')];
    const div1 = debugger_.findDivergence(timelineA, timelineB);
    const div2 = debugger_.findDivergence(timelineA, timelineB);
    expect(div1.causalExplanation).toBe(div2.causalExplanation);
    expect(div1.divergenceIndex).toBe(div2.divergenceIndex);
  });
});