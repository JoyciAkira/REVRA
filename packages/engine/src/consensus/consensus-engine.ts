/**
 * Cross-engine consensus (PRD §3.1): engines submit claims about the same
 * binary region; the round decides by quorum, flags equivocating engines as
 * Byzantine, and publishes the agreed claim into the Shared Formal State.
 * Rounds are synchronous in-process: the <1ms p99 target is measured, not
 * assumed. Exact two-sided disagreements surface as DISPUTED for the kernel
 * reconciliation flow (Conflict Visibility).
 */
import { createHash } from 'node:crypto';
import type { AddressRange, Claim } from '@revra/contracts';
import { SharedFormalState } from './shared-state.js';

export type ConsensusOutcome = 'CONSENSUS' | 'DISPUTED' | 'INSUFFICIENT_QUORUM';

export interface EngineSubmission {
  engineId: string;
  binaryHash: string;
  addressRange: AddressRange;
  claim: Claim;
}

export interface ConsensusDecision {
  roundId: string;
  outcome: ConsensusOutcome;
  /** Present on CONSENSUS. */
  agreedClaimHash?: string;
  acceptedEngines: string[];
  rejected: Array<{ engineId: string; claimHash: string }>;
  byzantineEngines: string[];
  latencyMs: number;
  sharedStateVersion: number | null;
  ts: string;
}

export interface ConsensusMetricsSnapshot {
  rounds: number;
  consensus: number;
  disputed: number;
  insufficientQuorum: number;
  byzantineEngines: string[];
  p50Ms: number | null;
  p99Ms: number | null;
  sharedStateVersion: number;
}

const LATENCY_SAMPLES_MAX = 1000;

export function claimHash(claim: Claim): string {
  return createHash('sha256').update(JSON.stringify(claim)).digest('hex');
}

export interface ConsensusEngineOptions {
  /** Distinct engines required to agree for CONSENSUS (≥ f+1; default 2). */
  quorumSize?: number;
  idGen?: () => string;
  now?: () => string;
}

interface ClaimGroup {
  hash: string;
  engines: string[];
  submission: EngineSubmission;
}

export class ConsensusEngine {
  readonly sharedState = new SharedFormalState();
  private readonly latencies: number[] = [];
  private readonly byzantineSeen = new Set<string>();
  private rounds = 0;
  private consensusCount = 0;
  private disputedCount = 0;
  private insufficientCount = 0;
  private seq = 0;

  constructor(private readonly options: ConsensusEngineOptions = {}) {}

  submitRound(submissions: EngineSubmission[]): ConsensusDecision {
    const t0 = performance.now();
    this.rounds += 1;
    const quorum = this.options.quorumSize ?? 2;
    const now = this.now();
    const roundId = this.nextId('round');

    // Equivocation check: an engine advancing two different claims in one
    // round is Byzantine — all its submissions are dropped and remembered.
    const hashesByEngine = new Map<string, Set<string>>();
    for (const s of submissions) {
      const set = hashesByEngine.get(s.engineId) ?? new Set<string>();
      set.add(claimHash(s.claim));
      hashesByEngine.set(s.engineId, set);
    }
    const byzantine = [...hashesByEngine.entries()]
      .filter(([, hashes]) => hashes.size > 1)
      .map(([engineId]) => engineId);
    byzantine.forEach((id) => this.byzantineSeen.add(id));
    const honest = submissions.filter((s) => !byzantine.includes(s.engineId));

    const groups = new Map<string, ClaimGroup>();
    for (const s of honest) {
      const hash = claimHash(s.claim);
      const group = groups.get(hash) ?? { hash, engines: [], submission: s };
      if (!group.engines.includes(s.engineId)) group.engines.push(s.engineId);
      groups.set(hash, group);
    }

    const ranked = [...groups.values()].sort(
      (a, b) => b.engines.length - a.engines.length || (a.hash < b.hash ? -1 : 1),
    );
    const top = ranked[0];
    const distinctClaims = ranked.length;

    let outcome: ConsensusOutcome;
    if (!top || top.engines.length < quorum) {
      outcome = distinctClaims > 1 ? 'DISPUTED' : 'INSUFFICIENT_QUORUM';
    } else {
      outcome = 'CONSENSUS';
    }

    const decision: ConsensusDecision = {
      roundId,
      outcome,
      acceptedEngines: outcome === 'CONSENSUS' ? top!.engines : [],
      rejected: [],
      byzantineEngines: byzantine,
      latencyMs: 0,
      sharedStateVersion: null,
      ts: now,
    };

    if (outcome === 'CONSENSUS') {
      decision.agreedClaimHash = top!.hash;
      decision.rejected = submissions
        .filter((s) => !top!.engines.includes(s.engineId) || byzantine.includes(s.engineId))
        .map((s) => ({ engineId: s.engineId, claimHash: claimHash(s.claim) }));
      const entry = this.sharedState.publish(
        {
          claimHash: top!.hash,
          claim: top!.submission.claim,
          binaryHash: top!.submission.binaryHash,
          addressRange: top!.submission.addressRange,
          sourceEngines: top!.engines,
        },
        now,
      );
      decision.sharedStateVersion = entry.version;
      this.consensusCount += 1;
    } else if (outcome === 'DISPUTED') {
      this.disputedCount += 1;
    } else {
      this.insufficientCount += 1;
    }

    decision.latencyMs = performance.now() - t0;
    this.latencies.push(decision.latencyMs);
    if (this.latencies.length > LATENCY_SAMPLES_MAX) this.latencies.shift();
    return decision;
  }

  metrics(): ConsensusMetricsSnapshot {    const sorted = [...this.latencies].sort((a, b) => a - b);
    const percentile = (p: number): number | null =>
      sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]! : null;
    return {
      rounds: this.rounds,
      consensus: this.consensusCount,
      disputed: this.disputedCount,
      insufficientQuorum: this.insufficientCount,
      byzantineEngines: [...this.byzantineSeen],
      p50Ms: percentile(0.5),
      p99Ms: percentile(0.99),
      sharedStateVersion: this.sharedState.version,
    };
  }

  private nextId(prefix: string): string {
    return this.options.idGen ? this.options.idGen() : `${prefix}-${++this.seq}`;
  }

  private now(): string {
    return this.options.now ? this.options.now() : new Date().toISOString();
  }
}
