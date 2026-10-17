/**
 * Thin facade: the reliability policy lives in the kernel; this service only
 * validates request shapes at the boundary and delegates. Errors keep their
 * contract codes (KernelRuleError) for the HTTP filter to translate.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  actorSchema,
  type Actor,
  type AnalysisResult,
  type CoverageReport,
  type DegradationWarning,
  type EvidenceLevel,
  type ProofCertificate,
  type ProvenanceEvent,
  type ReconciliationReport,
  type SubmitResultInput,
  submitResultInputSchema,
  DEGRADATION_WARNINGS,
  EVIDENCE_LEVELS,
} from '@revra/contracts';
import { CertificateInput, EvidenceKernel, KernelRuleError } from '@revra/kernel';
import { z } from 'zod';
import { tenantIdFrom } from '../auth/tenant.js';
import { EVIDENCE_KERNEL } from '../tokens.js';

const promoteBodySchema = z.object({
  to: z.enum(EVIDENCE_LEVELS),
  actor: actorSchema,
  evidence: z.object({ evidenceRef: z.string().min(1).optional() }),
});

const refuteBodySchema = z.object({
  actor: actorSchema,
  evidence: z.object({
    evidenceRef: z.string().min(1).optional(),
    reason: z.string().optional(),
  }),
});

const degradeBodySchema = z.object({
  warning: z.enum(DEGRADATION_WARNINGS),
  actor: actorSchema,
});

const reconcileBodySchema = z.object({
  resultIdA: z.string().min(1),
  resultIdB: z.string().min(1),
});

@Injectable()
export class AnalysisService {
  // Property injection: robust under esbuild/tsx (no design:paramtypes) and tsc alike.
  @Inject(EVIDENCE_KERNEL)
  private readonly kernel!: EvidenceKernel;

  submit(body: { result: SubmitResultInput; actor: Actor }, tenantId?: string): AnalysisResult {
    const result = { ...body.result, tenantId: tenantId ?? body.result.tenantId };
    return this.kernel.submit(
      submitResultInputSchema.parse(result),
      actorSchema.parse(body.actor),
    );
  }

  promote(
    resultId: string,
    body: { to: EvidenceLevel; actor: Actor; evidence: { evidenceRef?: string } },
    tenantId?: string,
  ): AnalysisResult {
    const parsed = promoteBodySchema.parse(body);
    this.requireAccess(resultId, tenantId);
    return this.kernel.promote(resultId, parsed.to, parsed.actor, parsed.evidence);
  }

  degrade(
    resultId: string,
    body: { warning: DegradationWarning; actor: Actor },
    tenantId?: string,
  ): AnalysisResult {
    const parsed = degradeBodySchema.parse(body);
    this.requireAccess(resultId, tenantId);
    return this.kernel.degrade(resultId, parsed.warning, parsed.actor);
  }

  refute(
    resultId: string,
    body: { actor: Actor; evidence: { evidenceRef?: string; reason?: string } },
    tenantId?: string,
  ): AnalysisResult {
    const parsed = refuteBodySchema.parse(body);
    this.requireAccess(resultId, tenantId);
    return this.kernel.refute(resultId, parsed.actor, parsed.evidence);
  }

  async attachCertificate(
    resultId: string,
    body: { certificate: CertificateInput; actor: Actor },
    tenantId?: string,
  ): Promise<{ result: AnalysisResult; certificate?: ProofCertificate }> {
    this.requireAccess(resultId, tenantId);
    return this.kernel.attachCertificate(
      { ...body.certificate, resultId },
      actorSchema.parse(body.actor),
    );
  }

  reconcile(body: { resultIdA: string; resultIdB: string }): ReconciliationReport {
    const { resultIdA, resultIdB } = reconcileBodySchema.parse(body);
    return this.kernel.reconcile(resultIdA, resultIdB);
  }

  listResults(tenantId?: string): AnalysisResult[] {
    const all = this.kernel.listResults();
    return tenantId ? all.filter((r) => r.tenantId === tenantId) : all;
  }

  getResult(id: string, tenantId?: string): AnalysisResult {
    const result = this.kernel.getResult(id) ?? this.unknown(id);
    if (tenantId && result.tenantId && result.tenantId !== tenantId) {
      throw new KernelRuleError('TENANT_MISMATCH', 'the result belongs to another tenant');
    }
    return result;
  }

  getProvenance(id: string, tenantId?: string): ProvenanceEvent[] {
    this.getResult(id, tenantId);
    return this.kernel.getProvenance(id);
  }

  listReconciliations(): ReconciliationReport[] {
    return this.kernel.listReconciliations();
  }

  coverage(): CoverageReport {
    return this.kernel.coverage();
  }

  /** Ownership: in secure mode un tenant non tocca i risultati di un altro. */
  private requireAccess(resultId: string, tenantId?: string): void {
    const result = this.kernel.getResult(resultId);
    if (!result) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no analysis result with id ${resultId}`);
    }
    if (tenantId && result.tenantId && result.tenantId !== tenantId) {
      throw new KernelRuleError('TENANT_MISMATCH', 'the result belongs to another tenant');
    }
  }

  private unknown(id: string): never {
    throw new KernelRuleError('RESULT_NOT_FOUND', `no analysis result with id ${id}`);
  }
}
