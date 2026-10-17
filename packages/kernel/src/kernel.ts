/**
 * EvidenceKernel — the Evidence & Verification Kernel of PRD §0.
 *
 * Owns the append-only history of every analysis result and enforces the
 * reliability contracts of §0.2 at each state transition:
 *   - No Silent Promotion        (L1 → L2 needs tracked evidence)
 *   - AI Authority Boundary      (ai proposes L1, never verifies upward)
 *   - Bounded Guarantees         (L3 only with a VERIFIED, bound-matched certificate)
 *   - Graceful Degradation       (failed/absent verification → explicit warning, result kept)
 *   - Conflict Visibility        (reconciliation exposes DISPUTED, never hides it)
 *   - Provenance Preservation    (every transition appends an immutable event)
 */
import {
  actorSchema,
  addressRangeSchema,
  type Actor,
  type AnalysisResult,
  type CoverageReport,
  type DegradationWarning,
  type EvidenceLevel,
  type ProofCertificate,
  type ProvenanceEvent,
  type ReconciliationReport,
  type SubmitResultInput,
  DEFAULT_ELIGIBLE_CLAIM_KINDS,
  EVIDENCE_LEVELS,
  LEVEL_ORDER,
  proofCertificateSchema,
  submitResultInputSchema,
  verificationStateSchema,
} from '@revra/contracts';
import { z } from 'zod';
import { KernelRuleError } from './errors.js';
import type { ResultRecord } from './kernel-internal.js';
import { kernelSnapshotSchema, type KernelSnapshot } from './persistence/types.js';
import { certificateInputSchema, type CertificateInput, type ProofVerifier } from './verifier/types.js';

const submitContextSchema = z.object({
  actor: actorSchema,
});

const promoteContextSchema = z.object({
  actor: actorSchema,
  evidence: z.object({ evidenceRef: z.string().min(1).optional() }),
});

const MARKER_ACTOR_KINDS = ['symbolic', 'system', 'analyst'] as const;

export type { ResultRecord };

export interface EvidenceKernelOptions {
  idGen?: () => string;
  now?: () => string;
  eligibleClaimKinds?: readonly string[];
}

export class EvidenceKernel {
  private records = new Map<string, ResultRecord>();
  private certificates = new Map<string, ProofCertificate>();
  private reconciliations: ReconciliationReport[] = [];
  private verifier: ProofVerifier | undefined;
  private seq = 0;

  constructor(private readonly options: EvidenceKernelOptions = {}) {}

  /** Plug the machine proof checker used by attachCertificate (DI seam, tests included). */
  useVerifier(verifier: ProofVerifier): void {
    this.verifier = verifier;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getResult(id: string): AnalysisResult | undefined {
    return this.records.get(id)?.current;
  }

  listResults(): AnalysisResult[] {
    return [...this.records.values()].map((r) => r.current);
  }

  /** Full origin chain of a result — append-only, oldest first. */
  getProvenance(id: string): ProvenanceEvent[] {
    const record = this.requireRecord(id);
    return [...record.history];
  }

  getCertificate(resultId: string): ProofCertificate | undefined {
    return this.certificates.get(resultId);
  }

  /** Reconciliation ledger — every conflict is part of the permanent record. */
  listReconciliations(): ReconciliationReport[] {
    return [...this.reconciliations];
  }

  /**
   * Snapshot completo dell'universo di evidenza (F0.1): JSON-safe, validato
   * da kernelSnapshotSchema. Include i contatori per continuità degli id.
   */
  exportState(): KernelSnapshot {
    return kernelSnapshotSchema.parse({
      version: 1,
      seq: this.seq,
      records: [...this.records.values()].map((r) => ({
        current: r.current,
        history: [...r.history],
      })),
      certificates: [...this.certificates.values()],
      reconciliations: [...this.reconciliations],
    });
  }

  /**
   * Ripristina uno snapshot (persistenza F0.1). Sostituisce lo stato interno
   * con copie difensive; con idGen iniettato la continuità degli id è
   * responsabilità del caller (l'idGen di default riparte dal contatore
   * salvato nello snapshot).
   */
  restore(rawSnapshot: KernelSnapshot): void {
    const snapshot = kernelSnapshotSchema.parse(rawSnapshot);
    this.records = new Map(
      snapshot.records.map((r) => [r.current.id, { current: r.current, history: [...r.history] }]),
    );
    this.certificates = new Map(snapshot.certificates.map((c) => [c.resultId, c]));
    this.reconciliations = [...snapshot.reconciliations];
    this.seq = snapshot.seq;
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  submit(input: SubmitResultInput, rawActor: Actor): AnalysisResult {
    const parsed = submitResultInputSchema.parse(input);
    const { actor } = submitContextSchema.parse({ actor: rawActor });

    let state: EvidenceLevel;
    if (parsed.claim.kind === 'observed-bytes') {
      if (actor.kind === 'ai') {
        throw new KernelRuleError(
          'AI_AUTHORITY_BOUNDARY',
          'an AI actor cannot claim direct byte observation; only engines observe (L0)',
        );
      }
      state = 'L0';
    } else {
      state = 'L1';
    }

    const event = this.event(actor, {
      action: 'submit',
      engine: parsed.engineSource,
      toState: state,
      note: `claim ${parsed.claim.kind} entered at ${state}`,
    });
    const result: AnalysisResult = {
      ...parsed,
      id: this.nextId('res'),
      verification: { state, warnings: [] },
      provenance: [event],
    };
    this.records.set(result.id, { current: result, history: [event] });
    return result;
  }

  promote(
    resultId: string,
    to: EvidenceLevel,
    rawActor: Actor,
    evidence: { evidenceRef?: string },
  ): AnalysisResult {
    const record = this.requireRecord(resultId);
    const { actor, evidence: ev } = promoteContextSchema.parse({
      actor: rawActor,
      evidence,
    });
    const from = record.current.verification.state;

    if (to === from) {
      throw new KernelRuleError('INVALID_TRANSITION', `result already at ${to}`);
    }
    if (!(from in LEVEL_ORDER) || !(to in LEVEL_ORDER)) {
      throw new KernelRuleError(
        'INVALID_TRANSITION',
        `promotions apply to evidence levels, got ${from} → ${to}`,
      );
    }
    if (LEVEL_ORDER[to as EvidenceLevel] !== LEVEL_ORDER[from as EvidenceLevel] + 1) {
      throw new KernelRuleError(
        'INVALID_TRANSITION',
        `promotions move one level at a time, got ${from} → ${to}`,
      );
    }
    if (actor.kind === 'ai') {
      throw new KernelRuleError(
        'AI_AUTHORITY_BOUNDARY',
        'AI proposes (L1); only symbolic verification or analyst testing promotes',
      );
    }
    if (!ev.evidenceRef) {
      throw new KernelRuleError(
        'NO_SILENT_PROMOTION',
        `${from} → ${to} requires an explicit, tracked evidence reference`,
      );
    }
    if (to === 'L3' && this.certificates.get(resultId)?.outcome !== 'VERIFIED') {
      throw new KernelRuleError(
        'L3_REQUIRES_VERIFIED_CERTIFICATE',
        'formal proof (Bounded Guarantees) is mandatory for L3',
      );
    }

    return this.applyTransition(record, actor, 'promote', to, {
      evidenceRef: ev.evidenceRef,
    });
  }

  degrade(resultId: string, warning: DegradationWarning, rawActor: Actor): AnalysisResult {
    const record = this.requireRecord(resultId);
    const actor = actorSchema.parse(rawActor);
    const from = record.current.verification.state;

    if (!(from in LEVEL_ORDER) || from === 'L0') {
      throw new KernelRuleError(
        'INVALID_TRANSITION',
        `cannot degrade below L0 (state was ${from})`,
      );
    }
    const to = EVIDENCE_LEVELS[EVIDENCE_LEVELS.indexOf(from as EvidenceLevel) - 1]!;

    return this.applyTransition(record, actor, 'degrade', to, {
      note: warning,
      params: { warning },
    });
  }

  markUnsupported(resultId: string, rawActor: Actor, note?: string): AnalysisResult {
    const record = this.requireRecord(resultId);
    const actor = actorSchema.parse(rawActor);
    return this.applyTransition(record, actor, 'mark-unsupported', 'UNSUPPORTED', { note });
  }

  /** Causal note on the timeline: no evidence transition, history stays pure. */
  annotate(resultId: string, rawActor: Actor, note: string): AnalysisResult {
    const record = this.requireRecord(resultId);
    const actor = actorSchema.parse(rawActor);
    const from = record.current.verification.state;
    return this.applyTransition(record, actor, 'annotate', from, { note });
  }

  /**
   * Symbolic refutation of a candidate (PRD §3.1): the verdict is recorded
   * with its proof, the result stays visible at its level flagged REFUTED.
   * A formally proven (L3) claim is out of scope — invalidating a certificate
   * is a separate, auditable act.
   */
  refute(
    resultId: string,
    rawActor: Actor,
    evidence: { evidenceRef?: string; reason?: string },
  ): AnalysisResult {
    const record = this.requireRecord(resultId);
    const actor = actorSchema.parse(rawActor);
    if (actor.kind === 'ai') {
      throw new KernelRuleError(
        'AI_AUTHORITY_BOUNDARY',
        'verification verdicts — refutations included — belong to symbolic verification or analyst testing',
      );
    }
    if (!evidence.evidenceRef) {
      throw new KernelRuleError(
        'REFUTE_REQUIRES_EVIDENCE',
        'a refutation must cite the proof that falsifies the candidate',
      );
    }
    const from = record.current.verification.state;
    if (from !== 'L1' && from !== 'L2') {
      throw new KernelRuleError(
        'INVALID_TRANSITION',
        `refutations apply to L1/L2 candidates, got ${from}`,
      );
    }
    return this.applyTransition(record, actor, 'refute', from, {
      evidenceRef: evidence.evidenceRef,
      note: evidence.reason,
      params: { warning: 'REFUTED' },
    });
  }

  /**
   * Cross-engine proof reconciliation (PRD §3.1). Two results about the same
   * binary region: identical claims unify into one superseding result at the
   * highest evidence level; differing claims are marked DISPUTED on both
   * sides with a counterexample request — never silently resolved.
   * Claim equality compares canonical JSON (stable for schema-parsed claims).
   */
  reconcile(resultIdA: string, resultIdB: string): ReconciliationReport {
    if (resultIdA === resultIdB) {
      throw new KernelRuleError('INVALID_TRANSITION', 'a result cannot reconcile with itself');
    }
    const recA = this.requireRecord(resultIdA);
    const recB = this.requireRecord(resultIdB);
    const stateA = recA.current.verification.state;
    const stateB = recB.current.verification.state;
    if (!(stateA in LEVEL_ORDER) || !(stateB in LEVEL_ORDER)) {
      throw new KernelRuleError(
        'INVALID_TRANSITION',
        `reconciliation applies to evidence levels, got ${stateA} / ${stateB}`,
      );
    }
    if (!this.sameReconcilableRegion(recA.current, recB.current)) {
      throw new KernelRuleError(
        'RECONCILE_INCOMPATIBLE',
        'results must come from the same binary, architecture and overlapping range',
      );
    }

    const system: Actor = { kind: 'system', id: 'revra-kernel' };
    const claimsEqual =
      JSON.stringify(recA.current.claim) === JSON.stringify(recB.current.claim);
    const report: ReconciliationReport = {
      id: this.nextId('rec'),
      outcome: claimsEqual ? 'UNIFIED' : 'DISPUTED',
      resultIdA,
      resultIdB,
      counterexampleRequested: !claimsEqual,
      ts: this.now(),
    };

    if (claimsEqual) {
      report.unifiedResultId = this.unify(recA, recB, system, report.id);
      this.applyTransition(recA, system, 'superseded-by', stateA, {
        params: { unifiedResultId: report.unifiedResultId },
      });
      this.applyTransition(recB, system, 'superseded-by', stateB, {
        params: { unifiedResultId: report.unifiedResultId },
      });
    } else {
      report.disputedSides = [recA, recB].map((rec) => ({
        resultId: rec.current.id,
        engineSource: rec.current.engineSource,
        state: rec.current.verification.state,
        claim: rec.current.claim,
      }));
      this.applyTransition(recA, system, 'mark-disputed', 'DISPUTED', {
        params: { reconciliationId: report.id },
      });
      this.applyTransition(recB, system, 'mark-disputed', 'DISPUTED', {
        params: { reconciliationId: report.id },
      });
    }

    this.reconciliations.push(report);
    return report;
  }

  // ---------------------------------------------------------------------------
  // Coverage (PRD §0.3 — Dual Coverage Metrics)
  // ---------------------------------------------------------------------------

  coverage(eligibleClaimKinds?: readonly string[]): CoverageReport {
    const kinds = eligibleClaimKinds ?? this.options.eligibleClaimKinds ?? DEFAULT_ELIGIBLE_CLAIM_KINDS;
    const results = this.listResults();
    const eligible = results.filter(
      (r) =>
        (kinds as readonly string[]).includes(r.claim.kind) &&
        r.verification.state !== 'UNSUPPORTED',
    );
    const proven = eligible.filter((r) => this.certificates.get(r.id)?.outcome === 'VERIFIED');
    return {
      proofCoverage: {
        proven: proven.length,
        eligible: eligible.length,
        value: eligible.length > 0 ? proven.length / eligible.length : null,
      },
      eligibilityCoverage: {
        eligible: eligible.length,
        total: results.length,
        value: results.length > 0 ? eligible.length / results.length : null,
      },
    };
  }

  /**
   * Machine-check a proof certificate and react per Graceful Degradation:
   * VERIFIED → L3 (the only door to formal proven); PROOF_FAILED /
   * VERIFICATION_TIMEOUT / VERIFIER_UNAVAILABLE → explicit warning, result kept.
   */
  async attachCertificate(
    input: CertificateInput,
    rawActor: Actor,
  ): Promise<{ result: AnalysisResult; certificate?: ProofCertificate }> {
    const record = this.requireRecord(certificateInputSchema.parse(input).resultId);
    const actor = actorSchema.parse(rawActor);
    if (actor.kind !== 'symbolic' && actor.kind !== 'system') {
      throw new KernelRuleError(
        'AI_AUTHORITY_BOUNDARY',
        'certificates are checked by symbolic verifiers or the system, not proposed into existence',
      );
    }

    const certInput = certificateInputSchema.parse(input);
    this.requireCertificateBindsResult(certInput, record.current);

    const run = this.verifier
      ? await this.verifier.verify(certInput)
      : { outcome: 'VERIFIER_UNAVAILABLE' as const, detail: 'no verifier configured' };

    if (run.outcome === 'VERIFIED') {
      const certificate = proofCertificateSchema.parse({
        ...certInput,
        id: this.nextId('cert'),
        verifier: { name: this.verifier!.name, version: this.verifier!.version },
        outcome: 'VERIFIED',
        generatedAt: this.now(),
      });
      this.certificates.set(certInput.resultId, certificate);

      const result = this.applyTransition(record, actor, 'attach-certificate', 'L3', {
        evidenceRef: certificate.id,
        params: { verifier: certificate.verifier, theorem: certificate.theorem },
      });
      return { result, certificate };
    }

    if (run.outcome === 'VERIFIER_UNAVAILABLE') {
      const result = this.degradeWithWarning(record, actor, 'VERIFIER_UNAVAILABLE', run.detail);
      return { result };
    }

    // Proof ran and failed, or timed out: the attempt is preserved as evidence.
    const certificate = proofCertificateSchema.parse({
      ...certInput,
      id: this.nextId('cert'),
      verifier: { name: this.verifier!.name, version: this.verifier!.version },
      outcome: run.outcome,
      generatedAt: this.now(),
    });
    this.certificates.set(certInput.resultId, certificate);
    const result = this.degradeWithWarning(record, actor, run.outcome, run.detail);
    return { result, certificate };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Merge two agreeing results into one superseding result at the highest level. */
  private unify(a: ResultRecord, b: ResultRecord, system: Actor, reconciliationId: string): string {
    const stateA = a.current.verification.state as EvidenceLevel;
    const stateB = b.current.verification.state as EvidenceLevel;
    const state = LEVEL_ORDER[stateA] >= LEVEL_ORDER[stateB] ? stateA : stateB;
    const mergeEvent = this.event(system, {
      action: 'reconcile-merge',
      toState: state,
      params: { reconciliationId, merged: [a.current.id, b.current.id] },
    });
    const history = [...a.history, ...b.history, mergeEvent];
    const merged: AnalysisResult = {
      id: this.nextId('unified'),
      binaryHash: a.current.binaryHash,
      arch: a.current.arch,
      addressRange: a.current.addressRange,
      engineSource: `reconciled(${a.current.engineSource}+${b.current.engineSource})`,
      claim: a.current.claim,
      verification: { state, warnings: [] },
      provenance: history,
    };
    this.records.set(merged.id, { current: merged, history });
    return merged.id;
  }

  private sameReconcilableRegion(a: AnalysisResult, b: AnalysisResult): boolean {
    if (a.binaryHash !== b.binaryHash || a.arch !== b.arch) {
      return false;
    }
    const startA = Number(a.addressRange.start);
    const endA = Number(a.addressRange.end);
    const startB = Number(b.addressRange.start);
    const endB = Number(b.addressRange.end);
    return startA <= endB && startB <= endA;
  }

  private requireRecord(id: string): ResultRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no analysis result with id ${id}`);
    }
    return record;
  }

  private requireCertificateBindsResult(
    cert: CertificateInput,
    result: AnalysisResult,
  ): void {
    const range = addressRangeSchema.parse(result.addressRange);
    const mismatch =
      cert.binaryHash !== result.binaryHash ||
      cert.arch !== result.arch ||
      cert.instructionRange.start !== range.start ||
      cert.instructionRange.end !== range.end;
    if (mismatch) {
      throw new KernelRuleError(
        'CERTIFICATE_MISMATCH',
        'certificate must bind the exact binary, architecture and instruction range it proves',
      );
    }
  }

  /** Append the event, then derive the next immutable snapshot from the history. */
  private applyTransition(
    record: ResultRecord,
    actor: Actor,
    action: string,
    to: ProvenanceEvent['toState'],
    extra: Partial<ProvenanceEvent> = {},
  ): AnalysisResult {
    const event = this.event(actor, {
      action,
      toState: to,
      fromState: record.current.verification.state,
      ...extra,
    });
    record.history.push(event);

    const warnings =
      action === 'degrade' || action === 'refute'
        ? [...new Set([...record.current.verification.warnings, String(extra.params?.warning ?? event.note)])]
        : record.current.verification.warnings;

    record.current = {
      ...record.current,
      verification: {
        state: verificationStateSchema.parse(to),
        warnings: action === 'promote' ? [] : warnings,
      },
      provenance: [...record.history],
    };
    return record.current;
  }

  /** Graceful degradation: da L2 scende a L1; da L1 resta L1 con warning (l'ipotesi non è confutata). */
  private degradeWithWarning(
    record: ResultRecord,
    actor: Actor,
    warning: DegradationWarning,
    detail?: string,
  ): AnalysisResult {
    const from = record.current.verification.state;
    const to =
      from === 'L2' ? 'L1' : from;

    return this.applyTransition(record, actor, 'degrade', to, {
      params: { warning },
      note: `${warning}${detail ? ` (${detail})` : ''} — result kept, never silently promoted`,
    });
  }

  private event(actor: Actor, fields: Omit<ProvenanceEvent, 'id' | 'ts' | 'actor'>): ProvenanceEvent {
    return {
      id: this.nextId('evt'),
      ts: this.now(),
      actor,
      ...fields,
    };
  }

  private nextId(prefix: string): string {
    return this.options.idGen ? this.options.idGen() : `${prefix}-${++this.seq}`;
  }

  private now(): string {
    return this.options.now ? this.options.now() : new Date().toISOString();
  }
}
