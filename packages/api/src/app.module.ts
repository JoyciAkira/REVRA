import { Module } from '@nestjs/common';
import { AnalysisModule } from './analysis/analysis.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CognitiveModule } from './cognitive/cognitive.module.js';
import { EngineModule } from './engine/engine.module.js';
import { EpistemicModule } from './epistemic/epistemic.module.js';
import { FormatsModule } from './formats/formats.module.js';
import { PersistenceModule } from './persistence/persistence.module.js';
import { SovereignModule } from './sovereign/sovereign.module.js';
import { TimelineModule } from './timeline/timeline.module.js';
import { TriageModule } from './triage/triage.module.js';
import { ObservabilityModule } from './observability/observability.module.js';

@Module({
  imports: [
    AnalysisModule,
    EngineModule,
    CognitiveModule,
    TimelineModule,
    EpistemicModule,
    SovereignModule,
    FormatsModule,
    PersistenceModule,
    AuthModule,
    AuditModule,
    TriageModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
