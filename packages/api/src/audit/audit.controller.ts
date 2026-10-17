import { Controller, Get, Inject, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';

@Controller('audit')
export class AuditController {
  // @Inject nel costruttore: self-declared deps risolte anche senza decorator metadata.
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get('entries')
  entries(@Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '100', 10);
    return this.audit.latest(Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 100);
  }
}
