/**
 * Sovereign facade (PRD §3.4): provisioning PQC per tenant, attestation con
 * freshness, compliance statements firmati ML-DSA.
 */
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Attestation, ComplianceProof, TenantKeyInfo } from '@revra/contracts';
import { KernelRuleError } from '@revra/kernel';
import { SovereignService } from '@revra/engine';
import { SOVEREIGN_SERVICE } from './tokens.js';

const provisionBodySchema = z.object({ tenantId: z.string().min(1) });
const signBodySchema = z.object({ data: z.string().min(1) });
const attestBodySchema = z.object({
  enclaveId: z.string().min(1),
  teeVendor: z.enum(['Intel-TDX', 'AMD-SEV-SNP', 'ARM-CCA', 'software-simulated']),
  nonce: z.string().min(8).optional(),
});
const proveBodySchema = z.object({
  enclaveId: z.string().min(1),
  regulation: z.string().min(1),
  statement: z.string().min(1),
  internalLog: z.array(z.record(z.string(), z.unknown())).min(1),
  publicInputs: z.record(z.string(), z.unknown()),
});

@Injectable()
export class SovereignApiService {
  @Inject(SOVEREIGN_SERVICE)
  private readonly sovereign!: SovereignService;

  provision(body: unknown): TenantKeyInfo {
    const { tenantId } = provisionBodySchema.parse(body);
    return this.sovereign.provisionTenantKey(tenantId, new Date().toISOString());
  }

  sign(tenantId: string, body: unknown): { signature: string } {
    const { data } = signBodySchema.parse(body);
    return this.sovereign.signForTenant(tenantId, data);
  }

  attest(body: unknown): Attestation {
    const parsed = attestBodySchema.parse(body);
    return this.sovereign.attest({
      enclaveId: parsed.enclaveId,
      teeVendor: parsed.teeVendor,
      nonce: parsed.nonce ?? this.sovereign.randomNonce(),
      now: new Date().toISOString(),
    });
  }

  prove(body: unknown): ComplianceProof {
    const input = proveBodySchema.parse(body);
    return this.sovereign.proveCompliance({ ...input, now: new Date().toISOString() });
  }

  verifyProof(id: string): { verified: boolean } {
    const proof = this.sovereign.getProof(id);
    if (!proof) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no compliance proof with id ${id}`);
    }
    return { verified: this.sovereign.verifyCompliance(proof) };
  }
}
