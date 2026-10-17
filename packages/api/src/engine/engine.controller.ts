import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, UseFilters } from '@nestjs/common';
import type {
  ConsensusDecision,
  ConsensusMetricsSnapshot,
  HybridMetricsSnapshot,
  HybridRunReport,
  SharedFormalSnapshot,
} from '@revra/engine';
import { ReliabilityExceptionFilter } from '../analysis/reliability-exception.filter.js';
import { EngineService } from './engine.service.js';

@Controller()
@UseFilters(ReliabilityExceptionFilter)
export class EngineController {
  @Inject(EngineService)
  private readonly engine!: EngineService;

  @Post('hybrid/decompile')
  decompile(@Body() body: unknown): Promise<HybridRunReport> {
    return this.engine.decompile(body);
  }

  @Get('hybrid/metrics')
  hybridMetrics(): HybridMetricsSnapshot {
    return this.engine.hybridMetrics();
  }

  @Get('hybrid/falsifications')
  falsifications() {
    return this.engine.falsifications();
  }

  @Post('consensus/rounds')
  consensusRound(@Body() body: unknown): ConsensusDecision {
    return this.engine.consensusRound(body);
  }

  @Get('consensus/metrics')
  consensusMetrics(): ConsensusMetricsSnapshot {
    return this.engine.consensusMetrics();
  }

  @Get('consensus/state')
  sharedState(): SharedFormalSnapshot {
    return this.engine.sharedState();
  }
}
