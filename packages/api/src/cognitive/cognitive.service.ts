/**
 * Cognitive Symbiosis facade (PRD §3.2): records derived cognitive states
 * (never raw signals — the client strips them before sending), exposes the
 * BCI adapter registry and aggregate metrics. Adaptation decisions are made
 * client-side inside the <16ms budget; the server is the audit trail.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { BciAdapter, CognitiveState } from '@revra/contracts';
import type { BciAdapterHandle, SessionMetrics } from '@revra/engine';
import { BciBridge, CognitiveStateStore } from '@revra/engine';
import { bciAdapterSchema, cognitiveStateSchema } from '@revra/contracts';
import { BCI_BRIDGE, COGNITIVE_STORE } from './tokens.js';

const stateBodySchema = cognitiveStateSchema.omit({ ts: true });

@Injectable()
export class CognitiveService {
  @Inject(COGNITIVE_STORE)
  private readonly store!: CognitiveStateStore;

  @Inject(BCI_BRIDGE)
  private readonly bridge!: BciBridge;

  recordState(body: unknown, now: string): CognitiveState {
    const parsed = stateBodySchema.parse(body);
    const state: CognitiveState = { ...parsed, ts: now };
    this.store.record(state);
    return state;
  }

  statesFor(sessionId: string): CognitiveState[] {
    return this.store.forSession(sessionId);
  }

  metrics(): SessionMetrics {
    return this.store.metrics();
  }

  registerBciAdapter(body: unknown, now: string): BciAdapterHandle {
    const registration = bciAdapterSchema.parse(body) as BciAdapter;
    return this.bridge.register(registration, now);
  }

  listBciAdapters(): BciAdapterHandle[] {
    return this.bridge.list();
  }
}
