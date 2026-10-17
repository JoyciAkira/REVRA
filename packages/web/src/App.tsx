/**
 * REVRA · Evidence & Verification Kernel — dashboard G1 (PRD §0, §6.1).
 * Mostra ogni risultato con la sua etichetta di evidenza esplicita, le
 * metriche di copertura doppie e la catena di provenienza; ogni azione che
 * viola un contratto affidabilità mostra il codice della regola accanto a sé.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Actor,
  AnalysisResult,
  CoverageReport,
  ProvenanceEvent,
  UiAdaptation,
} from '@revra/contracts';
import { AdaptivePolicy } from '@revra/engine/adaptive-policy';
import { ApiError, api, DEMO_ACTORS, engineApi, epistemicApi, formatsApi, sovereignApi, timelineApi } from './api.js';
import type {
  BranchInfo,
  ConsensusMetrics,
  CoverageMatrixLive,
  EpistemicHypothesis,
  EpistemicMetrics,
  HybridMetrics,
  RoutingResult,
} from './api.js';
import { CognitiveCollector } from './cognitive/collector.js';
import { buildScene } from './volumetric/scene.js';
import { renderVolumetric } from './volumetric/renderer.js';
import { cn } from './lib/cn.js';

/** Static badge palette per evidence state (Tailwind default tokens only). */
const BADGE_CLASS: Record<string, string> = {
  L0: 'border-neutral-300 bg-neutral-100 text-neutral-700',
  L1: 'border-amber-300 bg-amber-50 text-amber-800',
  L2: 'border-sky-300 bg-sky-50 text-sky-800',
  L3: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  DISPUTED: 'border-red-300 bg-red-50 text-red-800',
  UNKNOWN: 'border-zinc-300 bg-zinc-100 text-zinc-600',
  UNSUPPORTED: 'border-zinc-300 bg-zinc-100 text-zinc-600',
};

/** UI adaptation states (PRD §3.2): SIMPLIFY under load, EXPAND in flow. */
const ADAPTATION_CLASS: Record<string, string> = {
  STABLE: 'border-neutral-300 bg-neutral-100 text-neutral-700',
  SIMPLIFY: 'border-amber-300 bg-amber-50 text-amber-800',
  EXPAND: 'border-emerald-300 bg-emerald-50 text-emerald-800',
};

/** Capability status palette (universal coverage matrix, visione founder). */
const CAPABILITY_CLASS: Record<string, string> = {
  SUPPORTED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  DEGRADED: 'border-amber-300 bg-amber-50 text-amber-800',
  PLANNED: 'border-sky-300 bg-sky-50 text-sky-800',
  UNSUPPORTED: 'border-zinc-300 bg-zinc-100 text-zinc-600',
};

const DEMO_BINARY = {
  binaryHash: 'a1b2c3d4e5f60718',
  arch: 'x86_64',
  addressRange: { start: '0x401000', end: '0x4010ff' },
};

function EvidenceBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums',
        BADGE_CLASS[state] ?? BADGE_CLASS.UNKNOWN,
      )}
    >
      {state}
    </span>
  );
}

function CoverageCard({
  label,
  numerator,
  denominator,
  value,
  hint,
}: {
  label: string;
  numerator: number;
  denominator: number;
  value: number | null;
  hint: string;
}) {
  const pct = value === null ? 0 : Math.round(value * 1000) / 10;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-sm font-medium text-neutral-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900">
        {value === null ? '—' : `${pct}%`}
      </p>
      <p className="mt-1 text-xs tabular-nums text-neutral-500">
        {numerator} / {denominator} · {hint}
      </p>
      <div className="mt-3 h-2 w-full rounded-full bg-neutral-200">
        <div className="h-2 rounded-full bg-neutral-900" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function App() {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [coverage, setCoverage] = useState<CoverageReport | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [provenance, setProvenance] = useState<ProvenanceEvent[]>([]);
  const [actionError, setActionError] = useState<{ code: string; message: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hybridMetrics, setHybridMetrics] = useState<HybridMetrics | undefined>();
  const [consensusMetrics, setConsensusMetrics] = useState<ConsensusMetrics | undefined>();
  const [lastRun, setLastRun] = useState<string | undefined>();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [backend, setBackend] = useState<string | undefined>();
  const [epistemicMetrics, setEpistemicMetrics] = useState<EpistemicMetrics | undefined>();
  const [recentHypotheses, setRecentHypotheses] = useState<EpistemicHypothesis[]>([]);
  const [coverageMatrix, setCoverageMatrix] = useState<CoverageMatrixLive | undefined>();
  const [routeResult, setRouteResult] = useState<RoutingResult | undefined>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const demoCounter = useRef(0);

  // G3 — Cognitive Symbiosis: opt-in esplicito, segnali elaborati solo in locale.
  const [consent, setConsent] = useState<boolean>(() => localStorage.getItem('revra-cognitive-consent') === '1');
  const [adaptation, setAdaptation] = useState<UiAdaptation>('STABLE');
  const sessionIdRef = useRef(`sess-web-${Date.now()}`);
  const policyRef = useRef(new AdaptivePolicy());
  const collectorRef = useRef<CognitiveCollector | undefined>(undefined);

  useEffect(() => {
    if (!consent) {
      collectorRef.current?.stop();
      collectorRef.current = undefined;
      setAdaptation('STABLE');
      policyRef.current = new AdaptivePolicy();
      return;
    }
    const policy = policyRef.current;
    const collector = new CognitiveCollector({
      sessionId: sessionIdRef.current,
      onState: (sample) => {
        const decision = policy.decide(sample);
        setAdaptation(decision.adaptation);
        void engineApi
          .recordCognitiveState({
            sessionId: sessionIdRef.current,
            loadLevel: sample.loadLevel,
            flowScore: sample.flowScore,
            source: 'keyboard-mouse',
            adaptationApplied: decision.adaptation,
          })
          .catch(() => undefined);
      },
    });
    collector.start();
    collectorRef.current = collector;
    return () => {
      collector.stop();
      collectorRef.current = undefined;
    };
  }, [consent]);

  const toggleConsent = (): void =>
    setConsent((current) => {
      localStorage.setItem('revra-cognitive-consent', current ? '0' : '1');
      return !current;
    });

  const reload = useCallback(async () => {
    const [nextResults, nextCoverage, nextHybrid, nextConsensus, nextBranches, nextEpistemic, nextMatrix] = await Promise.all([
      api.listResults(),
      api.coverage(),
      engineApi.hybridMetrics().catch(() => undefined),
      engineApi.consensusMetrics().catch(() => undefined),
      timelineApi.branches().catch(() => [] as BranchInfo[]),
      epistemicApi.metrics().catch(() => undefined),
      formatsApi.matrix().catch(() => undefined),
    ]);
    setResults(nextResults);
    setCoverage(nextCoverage);
    setHybridMetrics(nextHybrid);
    setConsensusMetrics(nextConsensus);
    setBranches(nextBranches);
    if (nextEpistemic) setEpistemicMetrics(nextEpistemic);
    if (nextMatrix) setCoverageMatrix(nextMatrix);
    setSelectedId((current) =>
      current && nextResults.some((r) => r.id === current) ? current : nextResults[0]?.id,
    );
  }, []);

  // Rendering volumetrico: WebGPU quando disponibile, canvas 2D altrimenti (PRD §10).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void renderVolumetric(canvas, buildScene(results)).then(setBackend);
  }, [results]);

  useEffect(() => {
    reload()
      .catch(() => setActionError({ code: 'OFFLINE', message: 'API non raggiungibile su /analysis' }))
      .finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    if (!selectedId) {
      setProvenance([]);
      return;
    }
    api.getProvenance(selectedId).then(setProvenance).catch(() => setProvenance([]));
  }, [selectedId, results]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setActionError(undefined);
      try {
        await action();
        await reload();
      } catch (error) {
        if (error instanceof ApiError) {
          setActionError({ code: error.code, message: error.message });
        } else {
          setActionError({ code: 'INTERNAL', message: String(error) });
        }
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const selected = results.find((r) => r.id === selectedId);
  const demoPseudocode = (variant: number) => ({
    kind: 'decompilation',
    payload: { pseudocode: `int f() { return ${variant}; }` },
  });

  const submitDemo = (engine: 'ghidra' | 'radare2', actor: Actor) =>
    run(async () => {
      demoCounter.current += 1;
      await api.submit(
        {
          ...DEMO_BINARY,
          engineSource: engine,
          claim: demoPseudocode(demoCounter.current),
        },
        actor,
      );
    });

  const submitConflictForSelected = () =>
    run(async () => {
      demoCounter.current += 1;
      await api.submit(
        {
          ...DEMO_BINARY,
          engineSource: 'radare2',
          claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { /* divergente */ }' } },
        },
        DEMO_ACTORS.AI,
      );
      const conflicting = (await api.listResults()).at(-1)!;
      await api.reconcile(selected!.id, conflicting.id);
    });

  const runHybrid = () =>
    run(async () => {
      demoCounter.current += 1;
      const report = await engineApi.decompile(DEMO_BINARY);
      const summary = report.candidates
        .map((c) => (c.outcome === 'VERIFIED_PROMOTED' ? '✓ L2' : c.outcome === 'REFUTED' ? '✗ rifiutato' : '· indeciso'))
        .join(' · ');
      setLastRun(`Run ${report.runId}: ${summary} (${report.durationMs.toFixed(1)}ms)`);
    });

  const runConsensus = () =>
    run(async () => {
      demoCounter.current += 1;
      const claim = { kind: 'decompilation', payload: { pseudocode: `int f() { return ${demoCounter.current}; }` } };
      const decision = await engineApi.consensusRound(
        ['ghidra', 'radare2', 'd810'].map((engineId) => ({
          engineId,
          binaryHash: DEMO_BINARY.binaryHash,
          addressRange: DEMO_BINARY.addressRange,
          claim,
        })),
      );
      setLastRun(
        `Round ${decision.roundId}: ${decision.outcome} · ${decision.acceptedEngines.length} engine accettati · ${decision.latencyMs.toFixed(3)}ms`,
      );
    });

  const doBranch = () =>
    run(async () => {
      if (!selected) return;
      demoCounter.current += 1;
      const branch = await timelineApi.branch(selected.id, `universe-${demoCounter.current}`);
      setLastRun(`Universo "${branch.label}" aperto: nuovo result ${branch.branchedResultId}`);
    });

  const doMergeFirstTwo = () =>
    run(async () => {
      const [a, b] = branches;
      if (!a || !b) return;
      const report = await timelineApi.merge(a.branchId, b.branchId);
      setLastRun(
        report.outcome === 'UNIFIED'
          ? `Merge UNIFICATO → ${report.unifiedResultId}`
          : 'Merge DISPUTED: counterexample richiesto',
      );
    });

  const doGenerateHypotheses = () =>
    run(async () => {
      demoCounter.current += 1;
      const hypotheses = await epistemicApi.generate({
        binaryHash: DEMO_BINARY.binaryHash,
        arch: DEMO_BINARY.arch,
        firstEngineSource: 'ghidra',
      });
      setRecentHypotheses(hypotheses.slice(0, 3));
    });

  const doProvisionPqc = () =>
    run(async () => {
      const info = await sovereignApi.provision('tenant-demo');
      setLastRun(`Chiavi PQC ${info.algorithm} provisionate per ${info.tenantId} · fp ${info.publicKeyFingerprint.slice(0, 12)}…`);
    });

  const doAttestEnclave = () =>
    run(async () => {
      const attestation = await sovereignApi.attest('enclave-demo', 'AMD-SEV-SNP');
      setLastRun(
        attestation.outcome === 'VERIFIED'
          ? `Enclave ${attestation.enclaveId} attestata (${attestation.teeVendor}) — quote ML-DSA verificata`
          : `Attestation REJECTED: ${attestation.reason}`,
      );
    });

  const doProveCompliance = () =>
    run(async () => {
      const proof = await sovereignApi.proveCompliance(
        'enclave-demo',
        'GDPR',
        "nessun dato classificato ha lasciato l'enclave",
      );
      setLastRun(
        `Compliance ${proof.regulation}: ${proof.verified ? 'VERIFICATA' : 'FALLITA'} · root ${proof.commitmentRoot.slice(0, 12)}…`,
      );
    });

  const doDetectFile = (file: File): void => {
    if (file.size > 4 * 1024 * 1024) {
      setActionError({ code: 'FILE_TOO_LARGE', message: 'per la demo: binari fino a 4 MB' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (): void => {
      const buffer = new Uint8Array(reader.result as ArrayBuffer);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < buffer.length; i += CHUNK) {
        binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);
      void run(async () => {
        const result = await formatsApi.route(base64);
        setRouteResult(result);
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const requiresSelection = !selected;
  const primaryButton =
    'rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50';
  const secondaryButton =
    'rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50';

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <h1 className="text-balance text-xl font-semibold">
              REVRA · Evidence &amp; Verification Kernel
            </h1>
            <p className="text-pretty text-sm text-neutral-500">
              G1 Formal Verification · G2 Neural-Symbolic Hybrid &amp; Consensus · G3 Cognitive
              Symbiosis — PRD v2.0 §0, §3.1, §3.2
            </p>
          </div>
          <div className="flex items-center gap-3">
            {consent && (
              <span
                role="status"
                className={cn(
                  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
                  ADAPTATION_CLASS[adaptation] ?? ADAPTATION_CLASS.STABLE,
                )}
              >
                Adattamento UI: {adaptation}
              </span>
            )}
            <label className="flex items-center gap-2 text-sm text-neutral-600">
              <input
                type="checkbox"
                checked={consent}
                onChange={toggleConsent}
                className="size-4"
              />
              Telemetria cognitiva (opt-in, elaborazione locale)
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[1fr_340px]">
        <section className="space-y-6" aria-labelledby="coverage-heading">
          <div>
            <h2 id="coverage-heading" className="mb-3 text-sm font-semibold text-neutral-600">
              Copertura formale (metriche doppie, PRD §0.3)
            </h2>
            {loading ? (
              <p className="text-sm text-neutral-500">Caricamento…</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <CoverageCard
                  label="Proof Coverage"
                  numerator={coverage?.proofCoverage.proven ?? 0}
                  denominator={coverage?.proofCoverage.eligible ?? 0}
                  value={coverage?.proofCoverage.value ?? null}
                  hint="claim dimostrati / eleggibili"
                />
                <CoverageCard
                  label="Eligibility Coverage"
                  numerator={coverage?.eligibilityCoverage.eligible ?? 0}
                  denominator={coverage?.eligibilityCoverage.total ?? 0}
                  value={coverage?.eligibilityCoverage.value ?? null}
                  hint="claim eleggibili / totali"
                />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4" aria-labelledby="g2-heading">
            <h2 id="g2-heading" className="mb-3 text-sm font-semibold text-neutral-600">
              G2 · Ibrido neurale-simbolico &amp; Consenso (PRD §3.1)
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-neutral-500">First-attempt correctness (target &gt;95%)</p>
                <p className="text-2xl font-semibold tabular-nums text-neutral-900">
                  {hybridMetrics?.firstAttemptCorrectness == null
                    ? '—'
                    : `${Math.round(hybridMetrics.firstAttemptCorrectness * 1000) / 10}%`}
                </p>
                <p className="text-xs tabular-nums text-neutral-500">
                  {hybridMetrics?.verified ?? 0} verificate / {hybridMetrics?.refuted ?? 0} rifiutate
                  su {hybridMetrics?.proposals ?? 0} proposte
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Consenso cross-engine (target p99 &lt;1ms)</p>
                <p className="text-2xl font-semibold tabular-nums text-neutral-900">
                  {consensusMetrics?.p99Ms == null ? '—' : `${(consensusMetrics.p99Ms * 1000).toFixed(0)}µs`}
                </p>
                <p className="text-xs tabular-nums text-neutral-500">
                  {consensusMetrics?.rounds ?? 0} round · stato condiviso v{consensusMetrics?.sharedStateVersion ?? 0}
                  {consensusMetrics?.byzantineEngines.length
                    ? ` · bizantini: ${consensusMetrics.byzantineEngines.join(', ')}`
                    : ''}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={primaryButton} disabled={busy} onClick={runHybrid}>
                Esegui decompilazione ibrida
              </button>
              <button type="button" className={secondaryButton} disabled={busy} onClick={runConsensus}>
                Round di consenso (3 engine)
              </button>
            </div>
            {lastRun && <p className="mt-3 text-xs text-neutral-600">{lastRun}</p>}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4" aria-labelledby="g4-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="g4-heading" className="text-sm font-semibold text-neutral-600">
                G4 · Timeline volumetrica (PRD §3.2)
              </h2>
              {backend && <span className="text-xs text-neutral-400">backend: {backend}</span>}
            </div>
            <canvas
              ref={canvasRef}
              width={640}
              height={224}
              className="w-full rounded-md border border-neutral-800"
              role="img"
              aria-label="Visualizzazione volumetrica: un punto per risultato, altezza = livello di evidenza"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={secondaryButton}
                disabled={busy || requiresSelection}
                onClick={doBranch}
              >
                Branch da qui
              </button>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy || branches.length < 2}
                onClick={doMergeFirstTwo}
              >
                Fondi primi due branch
              </button>
              <span className="text-xs tabular-nums text-neutral-500">
                {branches.length} universi paralleli
              </span>
            </div>
            {branches.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-neutral-600">
                {branches.slice(0, 4).map((b) => (
                  <li key={b.branchId} className="tabular-nums">
                    {b.label} → {b.branchedResultId} (origine {b.originResultId})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4" aria-labelledby="g5-heading">
            <h2 id="g5-heading" className="mb-3 text-sm font-semibold text-neutral-600">
              G5 · Living Epistemic Engine (PRD §3.3)
            </h2>
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-neutral-500">Accuracy ipotesi (target +2%/mese)</p>
                <p className="text-2xl font-semibold tabular-nums text-neutral-900">
                  {epistemicMetrics?.accuracy == null
                    ? '—'
                    : `${Math.round(epistemicMetrics.accuracy * 100)}%`}
                </p>
                <p className="text-xs tabular-nums text-neutral-500">
                  {epistemicMetrics?.confirmed ?? 0} confermate · {epistemicMetrics?.falsified ?? 0} falsificate ·
                  {' '}{epistemicMetrics?.patterns ?? 0} pattern
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Time-to-first-insight (target &lt;30s)</p>
                <p className="text-2xl font-semibold tabular-nums text-neutral-900">
                  {epistemicMetrics?.avgGenerationMs == null
                    ? '—'
                    : `${epistemicMetrics.avgGenerationMs.toFixed(1)}ms`}
                </p>
                {epistemicMetrics && epistemicMetrics.gaps.length > 0 && (
                  <p className="text-xs text-amber-700">
                    Gap: {epistemicMetrics.gaps[0]!.reason}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primaryButton}
                disabled={busy}
                onClick={doGenerateHypotheses}
              >
                Genera ipotesi (autonoma)
              </button>
            </div>
            {recentHypotheses.length > 0 && (
              <ul className="mt-3 space-y-2">
                {recentHypotheses.map((h) => (
                  <li key={h.id} className="text-xs text-neutral-600">
                    <span className="font-medium text-neutral-800">{h.prediction.family}</span>
                    {' '}· confidenza{' '}
                    <span className="tabular-nums">{Math.round(h.confidence * 100)}%</span>
                    <p className="text-pretty">{h.prediction.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4" aria-labelledby="g7-heading">
            <h2 id="g7-heading" className="mb-1 text-sm font-semibold text-neutral-600">
              Copertura universale — matrice live (PRD §3.1)
            </h2>
            <p className="mb-3 text-pretty text-xs text-neutral-500">
              Lo stato deriva dai probe runtime dei tool installati: SUPPORTED solo con engine
              disponibile, DEGRADED dichiarato se manca, PLANNED per gli ecosistemi in roadmap.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(coverageMatrix?.rows ?? []).map((row) => (
                <div
                  key={`${row.ecosystem}-${row.engineId}`}
                  className="rounded-md border border-neutral-200 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-neutral-800">{row.ecosystem}</span>
                    <span
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[10px] font-medium',
                        CAPABILITY_CLASS[row.status] ?? CAPABILITY_CLASS.UNSUPPORTED,
                      )}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs tabular-nums text-neutral-500">{row.engineId}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <span className="text-xs text-neutral-500">Rileva binario:</span>
                <input
                  type="file"
                  className="text-xs"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) doDetectFile(file);
                    event.target.value = '';
                  }}
                />
              </label>
              {routeResult && (
                <span
                  role="status"
                  className={cn(
                    'rounded border px-2 py-0.5 text-xs font-medium',
                    CAPABILITY_CLASS[routeResult.status] ?? CAPABILITY_CLASS.UNSUPPORTED,
                  )}
                >
                  {routeResult.detection
                    ? `${routeResult.detection.ecosystem} (${routeResult.detection.format})`
                    : 'formato non riconosciuto'}
                  {' · '}
                  {routeResult.status}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4" aria-labelledby="g6-heading">
            <h2 id="g6-heading" className="mb-3 text-sm font-semibold text-neutral-600">
              G6 · Sovereign Post-Quantum Enclave (PRD §3.4)
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={secondaryButton} disabled={busy} onClick={doProvisionPqc}>
                Provisiona chiavi tenant (ML-DSA-65)
              </button>
              <button type="button" className={secondaryButton} disabled={busy} onClick={doAttestEnclave}>
                Attesta enclave (SEV-SNP)
              </button>
              <button type="button" className={secondaryButton} disabled={busy} onClick={doProveCompliance}>
                Prova compliance GDPR
              </button>
            </div>
            <p className="mt-3 text-pretty text-xs text-neutral-500">
              Firme post-quantum reali (FIPS 204). Attestation con nonce freshness: il replay
              è respinto. La compliance è uno statement firmato PQC con commitment del log
              interno — il circuito ZK completo (Circom/Halo2) è il passo successivo.
            </p>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white">
            {results.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-pretty text-sm text-neutral-600">
                  Nessun risultato nel kernel: ogni analisi entra con un'etichetta di evidenza
                  esplicita.
                </p>
                <button
                  type="button"
                  className={cn(primaryButton, 'mt-4')}
                  disabled={busy}
                  onClick={() => submitDemo('ghidra', DEMO_ACTORS.AI)}
                >
                  Registra il primo risultato (L1 · AI)
                </button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Risultati di analisi con etichetta di evidenza</caption>
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                    <th scope="col" className="px-3 py-2 font-medium">Stato</th>
                    <th scope="col" className="px-3 py-2 font-medium">ID</th>
                    <th scope="col" className="px-3 py-2 font-medium">Motore</th>
                    {adaptation === 'EXPAND' && (
                      <th scope="col" className="px-3 py-2 font-medium">Binario</th>
                    )}
                    <th scope="col" className="px-3 py-2 font-medium">Claim</th>
                    <th scope="col" className="px-3 py-2 font-medium">Intervallo</th>
                    {adaptation !== 'SIMPLIFY' && (
                      <th scope="col" className="px-3 py-2 font-medium">Avvisi</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr
                      key={result.id}
                      className={cn(
                        'border-b border-neutral-100 last:border-0',
                        result.id === selectedId && 'bg-indigo-50/50',
                      )}
                    >
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="selected-result"
                            checked={result.id === selectedId}
                            onChange={() => setSelectedId(result.id)}
                            className="size-4"
                          />
                          <EvidenceBadge state={result.verification.state} />
                          <span className="sr-only">seleziona {result.id}</span>
                        </label>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{result.id}</td>
                      <td className="px-3 py-2">{result.engineSource}</td>
                      {adaptation === 'EXPAND' && (
                        <td className="px-3 py-2 font-mono text-xs" title={result.binaryHash}>
                          {result.binaryHash.slice(0, 8)}…
                        </td>
                      )}
                      <td className="px-3 py-2">{result.claim.kind}</td>
                      <td className="px-3 py-2 tabular-nums text-xs">
                        {result.addressRange.start}–{result.addressRange.end}
                      </td>
                      {adaptation !== 'SIMPLIFY' && (
                        <td className="px-3 py-2">
                          {result.verification.warnings.length === 0 ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            <span className="text-xs text-amber-700">
                              {result.verification.warnings.join(', ')}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="space-y-6" aria-labelledby="actions-heading">
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 id="actions-heading" className="mb-3 text-sm font-semibold text-neutral-600">
              Operazioni kernel
            </h2>
            <div className="space-y-2">
              <button
                type="button"
                className={cn(primaryButton, 'w-full')}
                disabled={busy}
                onClick={() => submitDemo('ghidra', DEMO_ACTORS.AI)}
              >
                Registra risultato L1 · ghidra (AI)
              </button>
              <button
                type="button"
                className={cn(secondaryButton, 'w-full')}
                disabled={busy || requiresSelection}
                onClick={submitConflictForSelected}
              >
                Carica esito divergente · radare2 + riconcilia
              </button>
              <button
                type="button"
                className={cn(secondaryButton, 'w-full')}
                disabled={busy || requiresSelection || selected?.verification.state !== 'L1'}
                title="Richiede un risultato selezionato in stato L1"
                onClick={() =>
                  run(() =>
                    api.promote(
                      selected!.id,
                      'L2',
                      DEMO_ACTORS.SYMBOLIC,
                      { evidenceRef: 'test://re-execution-suite' },
                    ),
                  )
                }
              >
                Promuovi L1 → L2 (verifica simbolica)
              </button>
              <button
                type="button"
                className={cn(secondaryButton, 'w-full')}
                disabled={busy || requiresSelection}
                onClick={() =>
                  run(() =>
                    api.attachCertificate(
                      selected!.id,
                      {
                        theorem: 'semantic-preservation',
                        proofTerm: 'theorem t : True := trivial',
                        semanticModel: 'lean4-imp-semantics@0.1',
                        property: 'output-equals-source-semantics',
                        assumptions: [],
                        binaryHash: selected!.binaryHash,
                        instructionRange: selected!.addressRange,
                        arch: selected!.arch,
                      },
                      DEMO_ACTORS.SYSTEM,
                    ),
                  )
                }
              >
                Verifica prova formale (Lean 4)
              </button>
              <button
                type="button"
                className={cn(secondaryButton, 'w-full')}
                disabled={busy || requiresSelection}
                onClick={() =>
                  run(() => api.degrade(selected!.id, 'VERIFICATION_TIMEOUT', DEMO_ACTORS.SYSTEM))
                }
              >
                Degradazione esplicita (timeout verifica)
              </button>
            </div>
            {actionError && (
              <p
                role="alert"
                className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                <span className="font-semibold">{actionError.code}</span> · {actionError.message}
              </p>
            )}
          </div>

          <div
            className={cn(
              'rounded-lg border border-neutral-200 bg-white p-4',
              adaptation === 'SIMPLIFY' && 'hidden',
            )}
          >
            <h2 className="mb-3 text-sm font-semibold text-neutral-600">Provenienza</h2>
            {provenance.length === 0 ? (
              <p className="text-pretty text-xs text-neutral-500">
                Seleziona un risultato per ispezionare la catena di origini (append-only, PRD §0.2).
              </p>
            ) : (
              <ol className="space-y-3">
                {provenance.map((event) => (
                  <li key={event.id} className="text-xs text-neutral-600">
                    <p className="font-medium text-neutral-800">
                      {event.action}
                      {event.fromState && event.toState && (
                        <span className="tabular-nums"> · {event.fromState} → {event.toState}</span>
                      )}
                    </p>
                    <p className="tabular-nums">
                      {event.actor.kind}:{event.actor.id}
                      {event.evidenceRef && <> · evidenza {event.evidenceRef}</>}
                    </p>
                    {event.note && <p className="text-pretty">{event.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
