/**
 * Persistenza del kernel (F0.1): snapshot JSON completo dell'universo di
 * evidenza — results con la loro history append-only, certificati,
 * reconciliation ledger, contatori id per continuità. Validato con zod al
 * restore: uno snapshot corrotto non entra mai nel kernel.
 */
import { z } from 'zod';
import type { ProofCertificate, ReconciliationReport } from '@revra/contracts';
import {
  analysisResultSchema,
  proofCertificateSchema,
  provenanceEventSchema,
  reconciliationReportSchema,
} from '@revra/contracts';
import type { ResultRecord } from '../kernel-internal.js';

export const kernelSnapshotSchema = z.object({
  version: z.literal(1),
  seq: z.number().int().nonnegative(),
  records: z.array(
    z.object({
      current: analysisResultSchema,
      history: z.array(provenanceEventSchema),
    }),
  ),
  certificates: z.array(proofCertificateSchema),
  reconciliations: z.array(reconciliationReportSchema),
});
export type KernelSnapshot = z.infer<typeof kernelSnapshotSchema>;

export type { ResultRecord, ProofCertificate, ReconciliationReport };
