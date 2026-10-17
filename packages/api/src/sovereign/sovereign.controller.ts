import { Body, Controller, Get, Inject, Param, Post, UseFilters } from '@nestjs/common';
import type { Attestation, ComplianceProof, TenantKeyInfo } from '@revra/contracts';
import { ReliabilityExceptionFilter } from '../analysis/reliability-exception.filter.js';
import { SovereignApiService } from './sovereign.service.js';

@Controller('sovereign')
@UseFilters(ReliabilityExceptionFilter)
export class SovereignController {
  @Inject(SovereignApiService)
  private readonly sovereign!: SovereignApiService;

  @Post('tenants/keys')
  provision(@Body() body: unknown): TenantKeyInfo {
    return this.sovereign.provision(body);
  }

  @Post('tenants/:tenantId/signatures')
  sign(@Param('tenantId') tenantId: string, @Body() body: unknown): { signature: string } {
    return this.sovereign.sign(tenantId, body);
  }

  @Post('attestations')
  attest(@Body() body: unknown): Attestation {
    return this.sovereign.attest(body);
  }

  @Post('compliance/proofs')
  prove(@Body() body: unknown): ComplianceProof {
    return this.sovereign.prove(body);
  }

  @Get('compliance/proofs/:id/verification')
  verify(@Param('id') id: string): { verified: boolean } {
    return this.sovereign.verifyProof(id);
  }
}
