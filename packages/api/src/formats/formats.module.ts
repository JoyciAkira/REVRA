import { Module } from '@nestjs/common';
import type { EvidenceKernel } from '@revra/kernel';
import {
  defaultAdapters,
  FormatEngineRegistry,
  UniversalAnalysisPipeline,
} from '@revra/engine';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { EVIDENCE_KERNEL } from '../tokens.js';
import { FormatsController } from './formats.controller.js';
import { FormatsService } from './formats.service.js';
import { FORMAT_ENGINE_REGISTRY, UNIVERSAL_PIPELINE } from './tokens.js';

/**
 * Universal coverage (G7/founder vision): la matrice è generata dai probe
 * runtime — tool assente = DEGRADED dichiarato, mai silenzi.
 */
@Module({
  imports: [AnalysisModule],
  controllers: [FormatsController],
  providers: [
    {
      provide: FORMAT_ENGINE_REGISTRY,
      useFactory: () => {
        const registry = new FormatEngineRegistry();
        for (const adapter of defaultAdapters()) {
          registry.register(adapter);
        }
        return registry;
      },
    },
    {
      provide: UNIVERSAL_PIPELINE,
      useFactory: (kernel: EvidenceKernel, registry: FormatEngineRegistry) =>
        new UniversalAnalysisPipeline({ kernel, registry }),
      inject: [EVIDENCE_KERNEL, FORMAT_ENGINE_REGISTRY],
    },
    FormatsService,
  ],
  exports: [FORMAT_ENGINE_REGISTRY, UNIVERSAL_PIPELINE],
})
export class FormatsModule {}
