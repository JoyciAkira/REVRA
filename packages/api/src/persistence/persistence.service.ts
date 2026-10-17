/**
 * Persistenza (F0.1/F0.3): al boot ripristina kernel, epistemic e timeline
 * dai rispettivi namespace; allo shutdown salva tutti. Con REVRA_DB non
 * impostato lo store è ':memory:' (comportamento volatile, come prima di F0.1).
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SqliteStateStore } from '@revra/kernel';
import type { EpistemicEngine, TimelineEngine } from '@revra/engine';
import { EvidenceKernel } from '@revra/kernel';
import { EVIDENCE_KERNEL } from '../tokens.js';
import { EPISTEMIC_ENGINE } from '../epistemic/tokens.js';
import { TIMELINE_ENGINE } from '../timeline/tokens.js';
import { STATE_STORE } from './tokens.js';

@Injectable()
export class PersistenceService implements OnModuleInit, OnModuleDestroy {
  @Inject(EVIDENCE_KERNEL)
  private readonly kernel!: EvidenceKernel;

  @Inject(EPISTEMIC_ENGINE)
  private readonly epistemic!: EpistemicEngine;

  @Inject(TIMELINE_ENGINE)
  private readonly timeline!: TimelineEngine;

  @Inject(STATE_STORE)
  private readonly store!: SqliteStateStore;

  onModuleInit(): void {
    const kernel = this.store.load('kernel');
    if (kernel) this.kernel.restore(kernel as Parameters<EvidenceKernel['restore']>[0]);
    const epistemic = this.store.load('epistemic');
    if (epistemic) this.epistemic.restore(epistemic);
    const timeline = this.store.load('timeline');
    if (timeline) this.timeline.restore(timeline as Parameters<TimelineEngine['restore']>[0]);
  }

  onModuleDestroy(): void {
    const now = new Date().toISOString();
    this.store.save('kernel', this.kernel.exportState(), now);
    this.store.save('epistemic', this.epistemic.exportState(), now);
    this.store.save('timeline', this.timeline.exportState(), now);
  }
}
