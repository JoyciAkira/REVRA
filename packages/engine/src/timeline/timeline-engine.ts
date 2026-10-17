/**
 * TimelineEngine (PRD §3.2): navigazione temporale sull'event log del kernel.
 * - snapshots: replay cumulativo → stato dell'evidenza a ogni evento
 * - causalChain: ogni step dichiara DA CHI è stato causato e CON QUALE prova
 * - branch: universi paralleli — un nuovo result parte dall'origine senza
 *   riscrivere la storia; il merge a convergenza riusa il reconcile del kernel
 */
import type {
  BranchInfo,
  CausalStep,
  TimelineSnapshot,
} from '@revra/contracts';
import { EvidenceKernel, KernelRuleError } from '@revra/kernel';
import { timelineStateSnapshotSchema, type TimelineStateSnapshot } from './persistence.js';

export interface TimelineEngineOptions {
  idGen?: () => string;
  now?: () => string;
}

export class TimelineEngine {
  private readonly branches = new Map<string, BranchInfo>();
  private seq = 0;

  constructor(
    private readonly deps: { kernel: EvidenceKernel },
    private readonly options: TimelineEngineOptions = {},
  ) {}

  /** Replay cumulativo: lo stato dell'evidenza dopo ogni evento. */
  snapshots(resultId: string): TimelineSnapshot[] {
    return this.deps.kernel.getProvenance(resultId).map((event) => ({
      eventId: event.id,
      ts: event.ts,
      action: event.action,
      state: event.toState ?? event.fromState ?? 'UNKNOWN',
      warnings: this.warningsUntil(resultId, event.id),
      actor: `${event.actor.kind}:${event.actor.id}`,
      evidenceRef: event.evidenceRef,
    }));
  }

  /** Causal chain: perché ogni stato esiste, con la prova che l'ha causato. */
  causalChain(resultId: string): CausalStep[] {
    const events = this.deps.kernel.getProvenance(resultId);
    return events.map((event, index) => ({
      eventId: event.id,
      action: event.action,
      actor: `${event.actor.kind}:${event.actor.id}`,
      causedBy: index > 0 ? events[index - 1]!.id : null,
      becauseEvidence: event.evidenceRef,
      becauseNote: event.note,
      fromState: event.fromState,
      toState: event.toState,
    }));
  }

  /**
   * Apre un universo parallelo dallo stato del result all'evento indicato:
   * il claim viene riproposto come nuovo result indipendente (L1), la
   * storia originale resta intatta.
   */
  branch(originResultId: string, eventId: string | undefined, label: string): BranchInfo {
    const kernel = this.deps.kernel;
    const origin = kernel.getResult(originResultId);
    if (!origin) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no analysis result with id ${originResultId}`);
    }
    const events = kernel.getProvenance(originResultId);
    const anchor = eventId
      ? events.find((e) => e.id === eventId)
      : events.at(-1);
    if (!anchor) {
      throw new KernelRuleError('INVALID_TRANSITION', `unknown timeline event ${eventId ?? '(last)'}`);
    }

    const branched = kernel.submit(
      {
        binaryHash: origin.binaryHash,
        arch: origin.arch,
        addressRange: origin.addressRange,
        engineSource: `branch:${label}`,
        claim: origin.claim,
      },
      { kind: 'system', id: 'revra-timeline' },
    );
    kernel.annotate(
      branched.id,
      { kind: 'system', id: 'revra-timeline' },
      `branched from ${originResultId} at event ${anchor.id} (${anchor.action}) — universe ${label}`,
    );

    const info: BranchInfo = {
      branchId: this.nextId('branch'),
      label,
      originResultId,
      originEventId: anchor.id,
      branchedResultId: branched.id,
      ts: this.now(),
    };
    this.branches.set(info.branchId, info);
    return info;
  }

  listBranches(): BranchInfo[] {
    return [...this.branches.values()];
  }

  /** Snapshot dei branch per la persistenza (F0.3). */
  exportState(): TimelineStateSnapshot {
    return timelineStateSnapshotSchema.parse({ branches: this.listBranches(), seq: this.seq });
  }

  restore(snapshot: TimelineStateSnapshot): void {
    const parsed = timelineStateSnapshotSchema.parse(snapshot);
    this.branches.clear();
    for (const branch of parsed.branches) this.branches.set(branch.branchId, branch);
    this.seq = parsed.seq;
  }

  /**
   * Merge di due branch: a convergenza (claim identici, stessa regione) il
   * kernel li unifica in un risultato superiore; in disaccordo li marca
   * DISPUTED con counterexample request. In entrambi i casi decide il kernel,
   * non la timeline.
   */
  merge(branchIdA: string, branchIdB: string) {
    const a = this.branches.get(branchIdA);
    const b = this.branches.get(branchIdB);
    if (!a || !b) {
      throw new KernelRuleError(
        'RESULT_NOT_FOUND',
        `no branch with id ${!a ? branchIdA : branchIdB}`,
      );
    }
    return this.deps.kernel.reconcile(a.branchedResultId, b.branchedResultId);
  }

  private warningsUntil(resultId: string, eventId: string): string[] {
    const warnings = new Set<string>();
    for (const event of this.deps.kernel.getProvenance(resultId)) {
      const note = event.note ?? '';
      if (event.action === 'degrade' || event.action === 'refute') {
        for (const w of ['VERIFICATION_TIMEOUT', 'PROOF_FAILED', 'VERIFIER_UNAVAILABLE', 'REFUTED']) {
          if (note.includes(w)) warnings.add(w);
        }
      }
      if (event.action === 'promote') warnings.clear();
      if (event.id === eventId) break;
    }
    return [...warnings];
  }

  private nextId(prefix: string): string {
    return this.options.idGen ? this.options.idGen() : `${prefix}-${++this.seq}`;
  }

  private now(): string {
    return this.options.now ? this.options.now() : new Date().toISOString();
  }
}
