/**
 * Temporal navigation facade (PRD §3.2): snapshots, causal chain, branching
 * e merge sopra il kernel condiviso — la decisione resta sempre al kernel.
 */
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { BranchInfo, CausalStep, ReconciliationReport, TimelineSnapshot } from '@revra/contracts';
import { TimelineEngine } from '@revra/engine';
import { EVIDENCE_KERNEL } from '../tokens.js';
import { TIMELINE_ENGINE } from './tokens.js';

const branchBodySchema = z.object({
  resultId: z.string().min(1),
  eventId: z.string().min(1).optional(),
  label: z.string().min(1),
});

const mergeBodySchema = z.object({
  branchIdA: z.string().min(1),
  branchIdB: z.string().min(1),
});

@Injectable()
export class TimelineService {
  @Inject(TIMELINE_ENGINE)
  private readonly timeline!: TimelineEngine;

  snapshots(resultId: string): TimelineSnapshot[] {
    return this.timeline.snapshots(resultId);
  }

  causalChain(resultId: string): CausalStep[] {
    return this.timeline.causalChain(resultId);
  }

  branch(body: unknown): BranchInfo {
    const { resultId, eventId, label } = branchBodySchema.parse(body);
    return this.timeline.branch(resultId, eventId, label);
  }

  listBranches(): BranchInfo[] {
    return this.timeline.listBranches();
  }

  merge(body: unknown): ReconciliationReport {
    const { branchIdA, branchIdB } = mergeBodySchema.parse(body);
    return this.timeline.merge(branchIdA, branchIdB);
  }
}
