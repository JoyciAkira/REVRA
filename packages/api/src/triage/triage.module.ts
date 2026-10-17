import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { EpistemicModule } from '../epistemic/epistemic.module.js';
import { TriageController } from './triage.controller.js';
import { TriageService } from './triage.service.js';

/** M1 workflow chiuso: un binario → tutta la conoscenza aggregata. */
@Module({
  imports: [AnalysisModule, EpistemicModule],
  controllers: [TriageController],
  providers: [TriageService],
})
export class TriageModule {}
