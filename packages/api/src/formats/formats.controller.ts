import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, UseFilters } from '@nestjs/common';
import type { CoverageMatrix, RoutingDecision } from '@revra/contracts';
import type { UniversalAnalysisReport } from '@revra/engine';
import { ReliabilityExceptionFilter } from '../analysis/reliability-exception.filter.js';
import { FormatsService } from './formats.service.js';

@Controller('formats')
@UseFilters(ReliabilityExceptionFilter)
export class FormatsController {
  @Inject(FormatsService)
  private readonly formats!: FormatsService;

  @Post('route')
  @HttpCode(HttpStatus.OK)
  async route(@Body() body: unknown): Promise<RoutingDecision> {
    return this.formats.route(body);
  }

  @Post('analyze')
  analyze(@Body() body: unknown): Promise<UniversalAnalysisReport> {
    return this.formats.analyze(body);
  }

  @Get('matrix')
  matrix(): Promise<CoverageMatrix> {
    return this.formats.matrix();
  }
}
