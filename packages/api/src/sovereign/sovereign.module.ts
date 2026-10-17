import { Module } from '@nestjs/common';
import { SovereignService } from '@revra/engine';
import { SovereignController } from './sovereign.controller.js';
import { SovereignApiService } from './sovereign.service.js';
import { SOVEREIGN_SERVICE } from './tokens.js';

/** G6 sovereign enclave services: PQC keys, attestation, compliance. */
@Module({
  controllers: [SovereignController],
  providers: [
    { provide: SOVEREIGN_SERVICE, useFactory: () => new SovereignService() },
    SovereignApiService,
  ],
})
export class SovereignModule {}
