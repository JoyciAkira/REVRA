/**
 * Dual Coverage Metrics (PRD §0.3): "100% formally verified" is meaningless
 * without also reporting how much of the corpus was even eligible.
 *
 *   Proof Coverage       = proven claims / eligible claims
 *   Eligibility Coverage = eligible claims / total claims
 */
import { z } from 'zod';

export const coverageReportSchema = z.object({
  proofCoverage: z.object({
    proven: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    value: z.number().nullable(),
  }),
  eligibilityCoverage: z.object({
    eligible: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    value: z.number().nullable(),
  }),
});
export type CoverageReport = z.infer<typeof coverageReportSchema>;
