import { Module } from '@nestjs/common';
import { SqliteStateStore } from '@revra/kernel';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { EpistemicModule } from '../epistemic/epistemic.module.js';
import { TimelineModule } from '../timeline/timeline.module.js';
import { EVIDENCE_KERNEL } from '../tokens.js';
import { PersistenceService } from './persistence.service.js';
import { STATE_STORE } from './tokens.js';

/**
 * F0.1/F0.3: REVRA_DB (percorso file SQLite) abilita la persistenza durevole
 * di kernel, epistemic e timeline; senza la variabile lo store è ':memory:'.
 */
@Module({
  imports: [AnalysisModule, EpistemicModule, TimelineModule],
  providers: [
    {
      provide: STATE_STORE,
      useFactory: () => new SqliteStateStore(process.env.REVRA_DB ?? ':memory:'),
    },
    PersistenceService,
  ],
})
export class PersistenceModule {}
