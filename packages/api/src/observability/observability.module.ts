import { Module } from '@nestjs/common';
import { MetricsRegistry } from './metrics.js';
import { ObservabilityController } from './observability.controller.js';
import { METRICS_REGISTRY } from './tokens.js';

@Module({
  controllers: [ObservabilityController],
  providers: [
    {
      provide: METRICS_REGISTRY,
      useFactory: () => new MetricsRegistry(),
    },
  ],
  exports: [METRICS_REGISTRY],
})
export class ObservabilityModule {}