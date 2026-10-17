/**
 * Lean 4 proof checker via la CLI lean (PRD §9 Formal Verification Stack).
 * Thin by design: il kernel possiede tutta la reliability policy, questo
 * adapter esegue solo il machine check con esiti espliciti.
 *
 * A1: proof caching — evita ri-verifica dello stesso theorem/model/proofTerm
 * (mitiga rischio PRD §10 "formal verification overhead inutilizzabile").
 *
 * Risoluzione tool robusta: prova 'lean' su PATH e poi il percorso standard
 * elan (~/.elan/bin/lean) — così funziona anche dove il PATH del processo
 * (worker di test, systemd) non include ~/.elan/bin.
 */
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { CertificateInput, ProofVerifier, VerifierRun } from './types.js';
import { ProofCache } from './proof-cache.js';

const VERIFY_TIMEOUT_MS = 60_000;
const DETECT_TIMEOUT_MS = 15_000;
const DETAIL_MAX_CHARS = 400;

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnFailed: boolean;
}

function runLeanCmd(leanBin: string, args: string[], timeoutMs: number): CliRun {
  const spawned = spawnSync(leanBin, args, {
    timeout: timeoutMs,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (spawned.error) {
    return { code: null, stdout: '', stderr: '', timedOut: false, spawnFailed: true };
  }
  return {
    code: spawned.status,
    stdout: spawned.stdout ?? '',
    stderr: spawned.stderr ?? '',
    timedOut: spawned.status === null,
    spawnFailed: false,
  };
}

function clip(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ');
  return flat.length > DETAIL_MAX_CHARS ? `${flat.slice(0, DETAIL_MAX_CHARS)}…` : flat;
}

function leanCandidates(explicit?: string): string[] {
  const candidates = explicit ? [explicit] : [];
  candidates.push('lean', join(homedir(), '.elan', 'bin', 'lean'));
  return [...new Set(candidates)];
}

export class Lean4CliVerifier implements ProofVerifier {
  readonly name = 'lean4';
  private readonly cache: ProofCache;

  private constructor(
    readonly version: string,
    private readonly leanBin: string,
    cache?: ProofCache,
  ) {
    this.cache = cache ?? new ProofCache();
  }

  /** Expose cache for testing/inspection. */
  get proofCache(): ProofCache {
    return this.cache;
  }

  /**
   * Prova i candidati noti ('lean' su PATH, poi ~/.elan/bin/lean) e ritorna
   * undefined quando nessuno è utilizzabile — il kernel degrada esplicitamente.
   */
  static async detect(explicit?: string, cache?: ProofCache): Promise<Lean4CliVerifier | undefined> {
    for (const leanBin of leanCandidates(explicit)) {
      const probe = runLeanCmd(leanBin, ['--version'], DETECT_TIMEOUT_MS);
      if (!probe.spawnFailed && !probe.timedOut && probe.code === 0) {
        const version = probe.stdout.match(/version\s+([^\s,]+)/i)?.[1] ?? 'unknown';
        return new Lean4CliVerifier(version, leanBin, cache);
      }
    }
    return undefined;
  }

  async verify(cert: CertificateInput): Promise<VerifierRun> {
    // A1: proof caching — evita ri-verifica dello stesso theorem/model/proofTerm.
    const cached = this.cache.get(cert);
    if (cached) {
      return { ...cached, detail: (cached.detail ? cached.detail + ' ' : '') + '[cache hit]' };
    }

    const dir = await mkdtemp(join(tmpdir(), 'revra-proof-'));
    const file = join(dir, 'proof.lean');
    try {
      await writeFile(
        file,
        `-- REVRA proof artifact · theorem: ${cert.theorem}\n-- model: ${cert.semanticModel}\n${cert.proofTerm}\n`,
        'utf8',
      );
      const run = runLeanCmd(this.leanBin, [file], VERIFY_TIMEOUT_MS);
      let outcome: VerifierRun;
      if (run.spawnFailed) {
        outcome = { outcome: 'VERIFIER_UNAVAILABLE', detail: 'lean CLI failed to start' };
      } else if (run.timedOut) {
        outcome = { outcome: 'VERIFICATION_TIMEOUT', detail: `exceeded ${VERIFY_TIMEOUT_MS}ms` };
      } else if (run.code !== 0) {
        outcome = { outcome: 'PROOF_FAILED', detail: clip(run.stderr || run.stdout) };
      } else {
        outcome = { outcome: 'VERIFIED' };
      }
      // Cache solo esiti deterministici (VERIFIED / PROOF_FAILED); timeout/unavailable non cachati.
      if (outcome.outcome === 'VERIFIED' || outcome.outcome === 'PROOF_FAILED') {
        this.cache.set(cert, outcome);
      }
      return outcome;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}