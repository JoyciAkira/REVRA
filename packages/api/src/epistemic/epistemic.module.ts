import { Module } from '@nestjs/common';
import { EpistemicController } from './epistemic.controller.js';
import { EpistemicService } from './epistemic.service.js';
import { EPISTEMIC_ENGINE } from './tokens.js';
import { EpistemicEngine } from '@revra/engine';

/** G5 living epistemic engine: hypotheses, causal reasoning, self-improvement. */
@Module({
  controllers: [EpistemicController],
  providers: [
    { provide: EPISTEMIC_ENGINE, useFactory: () => new EpistemicEngine() },
    EpistemicService,
  ],
  exports: [EPISTEMIC_ENGINE],
})
export class EpistemicModule {}
