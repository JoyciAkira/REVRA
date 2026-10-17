import { Body, Controller, Get, Inject, Param, Post, Query, UseFilters } from '@nestjs/common';
import type { Hypothesis } from '@revra/contracts';
import type { EpistemicMetrics } from '@revra/engine';
import { ReliabilityExceptionFilter } from '../analysis/reliability-exception.filter.js';
import { EpistemicService } from './epistemic.service.js';

@Controller('epistemic')
@UseFilters(ReliabilityExceptionFilter)
export class EpistemicController {
  @Inject(EpistemicService)
  private readonly epistemic!: EpistemicService;

  @Post('patterns')
  learnPattern(@Body() body: unknown): { patternId: string } {
    return this.epistemic.learnPattern(body);
  }

  @Post('hypotheses/generate')
  generate(@Body() body: unknown): Hypothesis[] {
    return this.epistemic.generate(body);
  }

  @Post('hypotheses/:id/verdicts')
  verdict(@Param('id') id: string, @Body() body: unknown): Hypothesis {
    return this.epistemic.applyVerdict(id, body);
  }

  @Get('hypotheses')
  hypotheses(): Hypothesis[] {
    return this.epistemic.listHypotheses();
  }

  @Post('causal/observations')
  observe(@Body() body: unknown): { recorded: true } {
    return this.epistemic.observe(body);
  }

  @Get('causal/relation')
  relation(
    @Query('cause') cause: string,
    @Query('effect') effect: string,
  ): { relation: string; observations?: number } {
    return this.epistemic.relation(cause, effect);
  }

  @Get('counterfactual')
  counterfactual(
    @Query('cause') cause: string,
    @Query('effect') effect: string,
  ): { text: string } {
    return this.epistemic.counterfactual(cause, effect);
  }

  @Get('metrics')
  metrics(): EpistemicMetrics {
    return this.epistemic.metrics();
  }
}
