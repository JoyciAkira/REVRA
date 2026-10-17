/**
 * Client HTTP dell'API REVRA. Ogni errore conserva il codice del contratto
 * PRD restituito dall'API (AI_AUTHORITY_BOUNDARY, NO_SILENT_PROMOTION, …)
 * così la UI può mostrarlo accanto all'azione che l'ha causato.
 */
import type {
  Actor,
  AnalysisResult,
  CoverageReport,
  DegradationWarning,
  EvidenceLevel,
  ProvenanceEvent,
  ReconciliationReport,
  SubmitResultInput,
} from '@revra/contracts';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined;
    throw new ApiError(
      body?.error?.code ?? 'HTTP_ERROR',
      response.status,
      body?.error?.message ?? `richiesta fallita (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

export interface AnalysisApi {
  listResults(): Promise<AnalysisResult[]>;
  getResult(id: string): Promise<AnalysisResult>;
  getProvenance(id: string): Promise<ProvenanceEvent[]>;
  coverage(): Promise<CoverageReport>;
  submit(result: SubmitResultInput, actor: Actor): Promise<AnalysisResult>;
  promote(
    id: string,
    to: EvidenceLevel,
    actor: Actor,
    evidence: { evidenceRef?: string },
  ): Promise<AnalysisResult>;
  degrade(id: string, warning: DegradationWarning, actor: Actor): Promise<AnalysisResult>;
  attachCertificate(
    id: string,
    certificate: Record<string, unknown>,
    actor: Actor,
  ): Promise<{ result: AnalysisResult }>;
  reconcile(resultIdA: string, resultIdB: string): Promise<ReconciliationReport>;
}

const AI: Actor = { kind: 'ai', id: 'neural-proposer' };
const SYMBOLIC: Actor = { kind: 'symbolic', id: 'type-inference-engine' };
const SYSTEM: Actor = { kind: 'system', id: 'revra-kernel' };

export const api: AnalysisApi = {
  listResults: () => request('/analysis/results'),
  getResult: (id) => request(`/analysis/results/${id}`),
  getProvenance: (id) => request(`/analysis/results/${id}/provenance`),
  coverage: () => request('/analysis/coverage'),
  submit: (result, actor) =>
    request('/analysis/results', { method: 'POST', body: JSON.stringify({ result, actor }) }),
  promote: (id, to, actor, evidence) =>
    request(`/analysis/results/${id}/promotions`, {
      method: 'POST',
      body: JSON.stringify({ to, actor, evidence }),
    }),
  degrade: (id, warning, actor) =>
    request(`/analysis/results/${id}/degradations`, {
      method: 'POST',
      body: JSON.stringify({ warning, actor }),
    }),
  attachCertificate: (id, certificate, actor) =>
    request(`/analysis/results/${id}/certificates`, {
      method: 'POST',
      body: JSON.stringify({ certificate, actor }),
    }),
  reconcile: (resultIdA, resultIdB) =>
    request('/analysis/reconciliations', {
      method: 'POST',
      body: JSON.stringify({ resultIdA, resultIdB }),
    }),
};

export const DEMO_ACTORS = { AI, SYMBOLIC, SYSTEM };

// ---------------------------------------------------------------------------
// G4 — Timeline & volumetric navigation (PRD §3.2)
// ---------------------------------------------------------------------------

export interface TimelineSnapshot {
  eventId: string;
  ts: string;
  action: string;
  state: string;
  warnings: string[];
  actor: string;
  evidenceRef?: string;
}

export interface BranchInfo {
  branchId: string;
  label: string;
  originResultId: string;
  branchedResultId: string;
}

export const timelineApi = {
  timelineOf: (id: string) =>
    request<{ snapshots: TimelineSnapshot[]; causalChain: Array<{ eventId: string; causedBy: string | null }> }>(
      `/timeline/results/${id}`,
    ),
  branch: (resultId: string, label: string) =>
    request<BranchInfo>('/timeline/branches', {
      method: 'POST',
      body: JSON.stringify({ resultId, label }),
    }),
  branches: () => request<BranchInfo[]>('/timeline/branches'),
  merge: (branchIdA: string, branchIdB: string) =>
    request<ReconciliationReport>('/timeline/merge', {
      method: 'POST',
      body: JSON.stringify({ branchIdA, branchIdB }),
    }),
};

// ---------------------------------------------------------------------------
// G5 — Living epistemic engine (PRD §3.3)
// ---------------------------------------------------------------------------

export interface EpistemicHypothesis {
  id: string;
  prediction: { family: string; rationale: string };
  confidence: number;
  status: 'PROPOSED' | 'CONFIRMED' | 'FALSIFIED';
  generatedInMs: number;
}

export interface EpistemicMetrics {
  patterns: number;
  hypotheses: number;
  confirmed: number;
  falsified: number;
  accuracy: number | null;
  gaps: Array<{ arch: string; reason: string }>;
  avgGenerationMs: number | null;
}

export const epistemicApi = {
  generate: (body: { binaryHash: string; arch: string; firstEngineSource: string }) =>
    request<EpistemicHypothesis[]>('/epistemic/hypotheses/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  metrics: () => request<EpistemicMetrics>('/epistemic/metrics'),
};

export interface HybridMetrics {
  proposals: number;
  verified: number;
  refuted: number;
  inconclusive: number;
  firstAttemptCorrectness: number | null;
  avgConfidence: number | null;
  runs: number;
}

export interface ConsensusMetrics {
  rounds: number;
  consensus: number;
  disputed: number;
  insufficientQuorum: number;
  byzantineEngines: string[];
  p50Ms: number | null;
  p99Ms: number | null;
  sharedStateVersion: number;
}

export interface HybridRunReport {
  runId: string;
  candidates: Array<{ resultId: string; confidence: number; outcome: string; reason?: string }>;
  durationMs: number;
}

export interface ConsensusDecision {
  roundId: string;
  outcome: string;
  acceptedEngines: string[];
  byzantineEngines: string[];
  latencyMs: number;
  sharedStateVersion: number | null;
}

// ---------------------------------------------------------------------------
// G6 — Sovereign post-quantum enclave (PRD §3.4)
// ---------------------------------------------------------------------------

export interface TenantKeyInfo {
  tenantId: string;
  algorithm: string;
  publicKeyFingerprint: string;
}

export interface Attestation {
  enclaveId: string;
  teeVendor: string;
  outcome: 'VERIFIED' | 'REJECTED';
  reason?: string;
}

export interface ComplianceProofResponse {
  id: string;
  regulation: string;
  verified: boolean;
  commitmentRoot: string;
}

export const sovereignApi = {
  provision: (tenantId: string) =>
    request<TenantKeyInfo>('/sovereign/tenants/keys', {
      method: 'POST',
      body: JSON.stringify({ tenantId }),
    }),
  attest: (enclaveId: string, teeVendor: string) =>
    request<Attestation>('/sovereign/attestations', {
      method: 'POST',
      body: JSON.stringify({ enclaveId, teeVendor }),
    }),
  proveCompliance: (enclaveId: string, regulation: string, statement: string) =>
    request<ComplianceProofResponse>('/sovereign/compliance/proofs', {
      method: 'POST',
      body: JSON.stringify({
        enclaveId,
        regulation,
        statement,
        internalLog: [{ event: 'egress', level: 'none' }],
        publicInputs: { maxEgressLevel: 'none', windowHours: 24 },
      }),
    }),
};

// ---------------------------------------------------------------------------
// G7 — Universal coverage matrix (visione founder)
// ---------------------------------------------------------------------------

export interface CoverageRow {
  ecosystem: string;
  engineId: string;
  status: 'SUPPORTED' | 'DEGRADED' | 'PLANNED' | 'UNSUPPORTED';
  reason?: string;
  benchmarkRef?: string;
}

export interface CoverageMatrixLive {
  generatedAt: string;
  rows: CoverageRow[];
}

export interface RoutingResult {
  detection: { ecosystem: string; format: string; confidence: number; magicEvidence: string } | null;
  engineId: string | null;
  status: 'SUPPORTED' | 'DEGRADED' | 'PLANNED' | 'UNSUPPORTED';
  reason?: string;
}

export const formatsApi = {
  matrix: () => request<CoverageMatrixLive>('/formats/matrix'),
  route: (binaryBase64: string) =>
    request<RoutingResult>('/formats/route', {
      method: 'POST',
      body: JSON.stringify({ binary: binaryBase64 }),
    }),
};

export const engineApi = {
  decompile: (ctx: { binaryHash: string; arch: string; addressRange: { start: string; end: string } }) =>
    request<HybridRunReport>('/hybrid/decompile', { method: 'POST', body: JSON.stringify(ctx) }),
  hybridMetrics: () => request<HybridMetrics>('/hybrid/metrics'),
  consensusRound: (submissions: Array<{ engineId: string; binaryHash: string; addressRange: { start: string; end: string }; claim: unknown }>) =>
    request<ConsensusDecision>('/consensus/rounds', { method: 'POST', body: JSON.stringify({ submissions }) }),
  consensusMetrics: () => request<ConsensusMetrics>('/consensus/metrics'),
  /** Solo lo stato derivato attraversa la rete — mai i segnali grezzi (PRD §3.2). */
  recordCognitiveState: (state: {
    sessionId: string;
    loadLevel: number;
    flowScore: number;
    source: 'keyboard-mouse';
    adaptationApplied: 'STABLE' | 'SIMPLIFY' | 'EXPAND';
  }) => request<{ sessionId: string }>('/cognitive/states', { method: 'POST', body: JSON.stringify(state) }),
};
