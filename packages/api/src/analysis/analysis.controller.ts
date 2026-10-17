import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req, UseFilters } from '@nestjs/common';
import type { Request } from 'express';
import type {
  Actor,
  AnalysisResult,
  CoverageReport,
  DegradationWarning,
  EvidenceLevel,
  ProofCertificate,
  ProvenanceEvent,
  ReconciliationReport,
  SubmitResultInput,
} from '@revra/contracts';
import type { CertificateInput } from '@revra/kernel';
import { AnalysisService } from './analysis.service.js';
import { ReliabilityExceptionFilter } from './reliability-exception.filter.js';
import { tenantIdFrom } from '../auth/tenant.js';

@Controller('analysis')
@UseFilters(ReliabilityExceptionFilter)
export class AnalysisController {
  @Inject(AnalysisService)
  private readonly analysis!: AnalysisService;

  @Post('results')
  submit(@Req() request: Request, @Body() body: { result: SubmitResultInput; actor: Actor }): AnalysisResult {
    return this.analysis.submit(body, tenantIdFrom(request));
  }

  @Post('results/:id/promotions')
  @HttpCode(HttpStatus.OK)
  promote(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { to: EvidenceLevel; actor: Actor; evidence: { evidenceRef?: string } },
  ): AnalysisResult {
    return this.analysis.promote(id, body, tenantIdFrom(request));
  }

  @Post('results/:id/degradations')
  @HttpCode(HttpStatus.OK)
  degrade(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { warning: DegradationWarning; actor: Actor },
  ): AnalysisResult {
    return this.analysis.degrade(id, body, tenantIdFrom(request));
  }

  @Post('results/:id/refutations')
  @HttpCode(HttpStatus.OK)
  refute(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { actor: Actor; evidence: { evidenceRef?: string; reason?: string } },
  ): AnalysisResult {
    return this.analysis.refute(id, body, tenantIdFrom(request));
  }

  @Post('results/:id/certificates')
  @HttpCode(HttpStatus.OK)
  async attachCertificate(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: { certificate: CertificateInput; actor: Actor },
  ): Promise<{ result: AnalysisResult; certificate?: ProofCertificate }> {
    return this.analysis.attachCertificate(id, body, tenantIdFrom(request));
  }

  @Post('reconciliations')
  reconcile(@Body() body: { resultIdA: string; resultIdB: string }): ReconciliationReport {
    return this.analysis.reconcile(body);
  }

  @Get('results')
  listResults(@Req() request: Request): AnalysisResult[] {
    return this.analysis.listResults(tenantIdFrom(request));
  }

  @Get('results/:id')
  getResult(@Req() request: Request, @Param('id') id: string): AnalysisResult {
    return this.analysis.getResult(id, tenantIdFrom(request));
  }

  @Get('results/:id/provenance')
  getProvenance(@Req() request: Request, @Param('id') id: string): ProvenanceEvent[] {
    return this.analysis.getProvenance(id, tenantIdFrom(request));
  }

  @Get('reconciliations')
  listReconciliations(): ReconciliationReport[] {
    return this.analysis.listReconciliations();
  }

  @Get('coverage')
  coverage(): CoverageReport {
    return this.analysis.coverage();
  }
}
