import { Module } from '@nestjs/common';
import { BciBridge, CognitiveStateStore } from '@revra/engine';
import { CognitiveController } from './cognitive.controller.js';
import { CognitiveService } from './cognitive.service.js';
import { BCI_BRIDGE, COGNITIVE_STORE } from './tokens.js';

/**
 * Cognitive telemetry registry (G3): derived states only, opt-in by design
 * on the client; the BCI bridge is the open API for EEG/fNIRS adapters.
 */
@Module({
  controllers: [CognitiveController],
  providers: [
    { provide: COGNITIVE_STORE, useFactory: () => new CognitiveStateStore() },
    { provide: BCI_BRIDGE, useFactory: () => new BciBridge() },
    CognitiveService,
  ],
})
export class CognitiveModule {}
