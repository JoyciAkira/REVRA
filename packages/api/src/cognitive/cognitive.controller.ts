import { Body, Controller, Get, Inject, Param, Post, UseFilters } from '@nestjs/common';
import type { CognitiveState } from '@revra/contracts';
import type { BciAdapterHandle, SessionMetrics } from '@revra/engine';
import { ReliabilityExceptionFilter } from '../analysis/reliability-exception.filter.js';
import { CognitiveService } from './cognitive.service.js';

@Controller('cognitive')
@UseFilters(ReliabilityExceptionFilter)
export class CognitiveController {
  @Inject(CognitiveService)
  private readonly cognitive!: CognitiveService;

  @Post('states')
  record(@Body() body: unknown): CognitiveState {
    return this.cognitive.recordState(body, new Date().toISOString());
  }

  @Get('states/:sessionId')
  statesFor(@Param('sessionId') sessionId: string): CognitiveState[] {
    return this.cognitive.statesFor(sessionId);
  }

  @Get('metrics')
  metrics(): SessionMetrics {
    return this.cognitive.metrics();
  }

  @Post('bci/adapters')
  registerAdapter(@Body() body: unknown): BciAdapterHandle {
    return this.cognitive.registerBciAdapter(body, new Date().toISOString());
  }

  @Get('bci/adapters')
  adapters(): BciAdapterHandle[] {
    return this.cognitive.listBciAdapters();
  }
}
