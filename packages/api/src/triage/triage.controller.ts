import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { TriageSummary } from './triage.service.js';
import { TriageService } from './triage.service.js';

@Controller('triage')
export class TriageController {
  @Inject(TriageService)
  private readonly triage!: TriageService;

  @Get(':binaryHash')
  summary(@Param('binaryHash') binaryHash: string): TriageSummary {
    return this.triage.summary(binaryHash);
  }
}
