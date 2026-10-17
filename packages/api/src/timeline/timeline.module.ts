import { Module } from '@nestjs/common';
import type { EvidenceKernel } from '@revra/kernel';
import { TimelineEngine } from '@revra/engine';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { EVIDENCE_KERNEL } from '../tokens.js';
import { TimelineController } from './timeline.controller.js';
import { TimelineService } from './timeline.service.js';
import { TIMELINE_ENGINE } from './tokens.js';

/** G4 temporal navigation on the shared kernel event log. */
@Module({
  imports: [AnalysisModule],
  controllers: [TimelineController],
  providers: [
    {
      provide: TIMELINE_ENGINE,
      useFactory: (kernel: EvidenceKernel) => new TimelineEngine({ kernel }),
      inject: [EVIDENCE_KERNEL],
    },
    TimelineService,
  ],
  exports: [TIMELINE_ENGINE],
})
export class TimelineModule {}
