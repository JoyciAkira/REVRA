/**
 * Persistenza timeline (F0.3): branch registry + contatore.
 * (Nome distinto da contracts.TimelineSnapshot = vista della timeline.)
 */
import { z } from 'zod';
import { branchInfoSchema } from '@revra/contracts';

export const timelineStateSnapshotSchema = z.object({
  branches: z.array(branchInfoSchema),
  seq: z.number().int().nonnegative(),
});
export type TimelineStateSnapshot = z.infer<typeof timelineStateSnapshotSchema>;
