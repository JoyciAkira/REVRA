/**
 * Rule violations surface as typed errors whose code mirrors the PRD §0.2
 * contract they enforce (AI_AUTHORITY_BOUNDARY, NO_SILENT_PROMOTION, …) so
 * APIs and UIs can explain exactly which reliability rule was hit.
 */
export class KernelRuleError extends Error {
  constructor(
    readonly code:
      | 'AI_AUTHORITY_BOUNDARY'
      | 'NO_SILENT_PROMOTION'
      | 'REFUTE_REQUIRES_EVIDENCE'
      | 'L3_REQUIRES_VERIFIED_CERTIFICATE'
      | 'INVALID_TRANSITION'
      | 'RESULT_NOT_FOUND'
      | 'CERTIFICATE_MISMATCH'
      | 'RECONCILE_INCOMPATIBLE'
      | 'TENANT_MISMATCH',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'KernelRuleError';
  }
}
