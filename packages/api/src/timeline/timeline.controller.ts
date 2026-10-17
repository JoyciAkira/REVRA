import { Body, Controller, Get, Inject, Param, Post, UseFilters } from '@nestjs/common';
import type { BranchInfo, CausalStep, ReconciliationReport, TimelineSnapshot } from '@revra/contracts';
import { ReliabilityExceptionFilter } from '../analysis/reliability-exception.filter.js';
import { TimelineService } from './timeline.service.js';

@Controller('timeline')
@UseFilters(ReliabilityExceptionFilter)
export class TimelineController {
  @Inject(TimelineService)
  private readonly timeline!: TimelineService;

  @Get('results/:id')
  timelineOf(@Param('id') id: string): { snapshots: TimelineSnapshot[]; causalChain: CausalStep[] } {
    return { snapshots: this.timeline.snapshots(id), causalChain: this.timeline.causalChain(id) };
  }

  @Post('branches')
  branch(@Body() body: unknown): BranchInfo {
    return this.timeline.branch(body);
  }

  @Get('branches')
  branches(): BranchInfo[] {
    return this.timeline.listBranches();
  }

  @Post('merge')
  merge(@Body() body: unknown): ReconciliationReport {
    return this.timeline.merge(body);
  }
}
