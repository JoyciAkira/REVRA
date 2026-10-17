/**
 * UnicornBehavioralVerifier (PRD §3.1: Behavioral Testing stage, M2).
 * Re-execution EMULATA su codice macchina reale: il candidato propone bytes
 * x86-64 e un output atteso (EAX); l'emulatore lo esegue e il verifier
 * confronta. VERIFIED/REFUTED portano l'evidenza del run — la promozione a
 * L2 empirica è la prima prova non-banale del pipeline.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CandidateVerdict,
  DecompileContext,
  DecompilationCandidate,
  SymbolicVerifier,
} from '../hybrid/types.js';

export interface UnicornVerifierOptions {
  /** Percorso dello script python (default: derivato dal modulo, override via env UNICORN_SCRIPT). */
  scriptPath?: string;
  pythonBin?: string;
  timeoutMs?: number;
}

interface UnicornRun {
  ok?: boolean;
  rax?: number;
  executed?: boolean;
}

interface BehavioralPayload {
  asmBytesHex?: unknown;
  expectedRax?: unknown;
}

function isBehavioralPayload(payload: unknown): payload is BehavioralPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as BehavioralPayload;
  return typeof candidate.asmBytesHex === 'string' && typeof candidate.expectedRax === 'number';
}

export class UnicornBehavioralVerifier implements SymbolicVerifier {
  readonly verifierId = 'unicorn-behavioral';
  readonly version = '0.1.0';
  private readonly scriptPath: string;

  constructor(options: UnicornVerifierOptions = {}) {
    this.scriptPath =
      options.scriptPath ??
      process.env.UNICORN_SCRIPT ??
      UnicornBehavioralVerifier.resolveScriptPath();
    this.pythonBin = options.pythonBin ?? 'python3';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Risolve lo script python senza import.meta (vietato in CJS emesso):
   * prova i percorsi plausibili dal cwd di runtime e dal pacchetto.
   */
  private static resolveScriptPath(): string {
    const candidates = [
      'packages/engine/scripts/unicorn_exec.py',
      'scripts/unicorn_exec.py',
      join(__dirname, '../../scripts/unicorn_exec.py'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return candidates[0]!;
  }

  private readonly pythonBin: string;
  private readonly timeoutMs: number;

  /** Unicorn installato? Probe rapido dell'interprete python con il modulo. */
  isAvailable(): boolean {
    const probe = spawnSync(this.pythonBin, ['-c', 'import unicorn'], { timeout: 15_000, encoding: 'utf8' });
    return probe.status === 0;
  }

  async verify(
    candidate: DecompilationCandidate,
    _ctx: DecompileContext,
  ): Promise<CandidateVerdict> {
    const payload = candidate.claim.payload;
    if (!isBehavioralPayload(payload)) {
      return {
        outcome: 'INCONCLUSIVE',
        reason: 'candidato non behavioral-testable (servono asmBytesHex e expectedRax)',
      };
    }

    let run: UnicornRun;
    try {
      const input = JSON.stringify({ codeHex: payload.asmBytesHex, baseAddr: 0x401000 });
      const spawned = spawnSync(this.pythonBin, [this.scriptPath], {
        input,
        timeout: this.timeoutMs,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
      if (spawned.error) {
        throw new Error(spawned.error.message);
      }
      if (spawned.status !== 0) {
        return {
          outcome: 'INCONCLUSIVE',
          reason: `unicorn exit ${spawned.status}: ${(spawned.stderr || '').slice(0, 200)}`,
        };
      }
      run = JSON.parse(spawned.stdout) as UnicornRun;
    } catch (error) {
      return {
        outcome: 'INCONCLUSIVE',
        reason: `unicorn run fallito: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
      };
    }

    if (!run.executed || typeof run.rax !== 'number') {
      return {
        outcome: 'INCONCLUSIVE',
        reason: 'emulazione terminata senza output osservabile',
      };
    }

    const evidenceRef = `unicorn://${this.verifierId}@${this.version}/run/${createHash('sha256')
      .update(payload.asmBytesHex + String(run.rax))
      .digest('hex')
      .slice(0, 12)}`;

    if (run.rax === payload.expectedRax) {
      return { outcome: 'VERIFIED', evidenceRef };
    }
    return {
      outcome: 'REFUTED',
      evidenceRef,
      reason: `EAX osservato ${run.rax} ≠ atteso ${payload.expectedRax}`,
    };
  }
}
