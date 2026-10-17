/**
 * A1++.4 — AtomicSymbolicVerifier (PRD §3.1, Beyond Limits).
 *
 * Verifica simbolica L2 per-istruzione tramite Triton (Apache-2.0,
 * JonathanSalwan/Triton). A differenza di Unicorn (che emula black-box e
 * osserva solo il valore finale di EAX), Triton produce l'albero SMT
 * bitvector esatto di come ogni atomo istruzionale trasforma lo stato.
 *
 * Questo permette la verifica atomica: invece di "il blocco produce EAX=60",
 * REVRA può dire "l'atomo mov eax,60 all'indirizzo 0x78 produce symbolicamente
 * RAX = BV(60, 32)" — evidenza composizionale che si aggancia al registry
 * atomico (A1++.1) e al compositore (A1++.2).
 *
 * Architettura: stesso seam `SymbolicVerifier` di UnicornBehavioralVerifier.
 * Triton gira come PROCESSO ESTERNO Python (harness triton_symbolic.py +
 * spawnSync), non linkato nel codice TS — evita problemi di licenza/ABI e
 * mantiene il boundary chiaro. Se Triton non è installato, isAvailable()
 * ritorna false e verify() degrada a VERIFIER_UNAVAILABLE (mai silente,
 * coerente col contratto Graceful Degradation PRD §0.2).
 *
 * Licenza harness: Apache-2.0 (Triton). Il wrapper TS è opera originale REVRA.
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

export interface TritonVerifierOptions {
  /** Percorso dello script python (default: derivato dal modulo, override via env TRITON_SCRIPT). */
  scriptPath?: string;
  pythonBin?: string;
  timeoutMs?: number;
}

interface TritonInstructionTrace {
  addr: number;
  bytes: string;
  disasm: string;
  raxAst: string | null;
}

interface TritonRun {
  ok?: boolean;
  unavailable?: boolean;
  reason?: string;
  executed?: number;
  partial?: boolean;
  rax?: number;
  perInstruction?: TritonInstructionTrace[];
}

interface SymbolicPayload {
  asmBytesHex?: unknown;
  expectedRax?: unknown;
}

function isSymbolicPayload(payload: unknown): payload is SymbolicPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as SymbolicPayload;
  return typeof candidate.asmBytesHex === 'string' && typeof candidate.expectedRax === 'number';
}

// Risolve la dir del modulo anche in CJS emesso (import.meta vietato lì):
// __dirname è disponibile nel bundle CJS; fallback su process.cwd().
const moduleDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

export class AtomicSymbolicVerifier implements SymbolicVerifier {
  readonly verifierId = 'triton-atomic-symbolic';
  readonly version = '0.1.0';
  private readonly scriptPath: string;
  private readonly pythonBin: string;
  private readonly timeoutMs: number;

  constructor(options: TritonVerifierOptions = {}) {
    this.scriptPath =
      options.scriptPath ??
      process.env.TRITON_SCRIPT ??
      AtomicSymbolicVerifier.resolveScriptPath();
    this.pythonBin = options.pythonBin ?? 'python3';
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /**
   * Risolve lo script python senza dipendere da import.meta in CJS:
   * prova i percorsi plausibili dal cwd di runtime e dal pacchetto.
   */
  private static resolveScriptPath(): string {
    const candidates = [
      'packages/engine/scripts/triton_symbolic.py',
      'scripts/triton_symbolic.py',
      join(moduleDir, '../../scripts/triton_symbolic.py'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return candidates[0]!;
  }

  /** Triton installato? Probe rapido dell'interprete python con il modulo. */
  isAvailable(): boolean {
    const probe = spawnSync(this.pythonBin, ['-c', 'import triton'], {
      timeout: 15_000,
      encoding: 'utf8',
    });
    return probe.status === 0;
  }

  async verify(
    candidate: DecompilationCandidate,
    _ctx: DecompileContext,
  ): Promise<CandidateVerdict> {
    const payload = candidate.claim.payload;
    if (!isSymbolicPayload(payload)) {
      return {
        outcome: 'INCONCLUSIVE',
        reason: 'candidato non symbolic-testable (servono asmBytesHex e expectedRax)',
      };
    }

    // Degrado esplicito se Triton non è installato (Graceful Degradation PRD §0.2).
    if (!this.isAvailable()) {
      return {
        outcome: 'INCONCLUSIVE',
        reason: 'VERIFIER_UNAVAILABLE: triton non installato (pip install triton) — L2 simbolico non disponibile, fallback a L2 empirico Unicorn',
      };
    }

    let run: TritonRun;
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
      // Exit code 2 = triton non installato (distinto da errore runtime).
      if (spawned.status === 2) {
        return {
          outcome: 'INCONCLUSIVE',
          reason: 'VERIFIER_UNAVAILABLE: triton non installato',
        };
      }
      if (spawned.status !== 0) {
        return {
          outcome: 'INCONCLUSIVE',
          reason: `triton exit ${spawned.status}: ${(spawned.stderr || '').slice(0, 200)}`,
        };
      }
      run = JSON.parse(spawned.stdout) as TritonRun;
    } catch (error) {
      return {
        outcome: 'INCONCLUSIVE',
        reason: `triton run fallito: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
      };
    }

    if (run.unavailable) {
      return {
        outcome: 'INCONCLUSIVE',
        reason: `VERIFIER_UNAVAILABLE: ${run.reason ?? 'triton non disponibile'}`,
      };
    }

    if (!run.ok || typeof run.rax !== 'number' || typeof run.executed !== 'number') {
      return {
        outcome: 'INCONCLUSIVE',
        reason: 'symbolic execution terminata senza output osservabile',
      };
    }

    // Evidenza atomica: hash del trace per-istruzione (non solo EAX finale).
    // Questo è il differenziale vs Unicorn: l'evidenza include l'albero simbolico
    // di ogni atomo, agganciabile al registry semantico (A1++.1).
    const traceFingerprint = (run.perInstruction ?? [])
      .map((t) => `${t.addr}:${t.bytes}:${t.raxAst ?? ''}`)
      .join('|');
    const evidenceRef = `triton://${this.verifierId}@${this.version}/run/${createHash('sha256')
      .update(payload.asmBytesHex + String(run.rax) + traceFingerprint)
      .digest('hex')
      .slice(0, 12)}`;

    if (run.rax === payload.expectedRax) {
      return {
        outcome: 'VERIFIED',
        evidenceRef,
        reason: run.partial
          ? `verificato simbolicamente su ${run.executed} atomi (parziale: ${run.reason})`
          : `verificato simbolicamente su ${run.executed} atomi`,
      };
    }
    return {
      outcome: 'REFUTED',
      evidenceRef,
      reason: `RAX simbolico/concreto ${run.rax} ≠ atteso ${payload.expectedRax} dopo ${run.executed} atomi`,
    };
  }

  /**
   * Estrae il trace per-istruzione da un candidato (utility per diagnostica e
   * per alimentare l'AtomicKnowledgeStore A1++.5). Ritorna null se Triton
   * non è disponibile o il candidato non è symbolic-testable.
   */
  async traceInstructions(
    candidate: DecompilationCandidate,
    _ctx: DecompileContext,
  ): Promise<ReadonlyArray<TritonInstructionTrace> | null> {
    const payload = candidate.claim.payload;
    if (!isSymbolicPayload(payload) || !this.isAvailable()) return null;
    try {
      const input = JSON.stringify({ codeHex: payload.asmBytesHex, baseAddr: 0x401000 });
      const spawned = spawnSync(this.pythonBin, [this.scriptPath], {
        input,
        timeout: this.timeoutMs,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
      if (spawned.status !== 0) return null;
      const run = JSON.parse(spawned.stdout) as TritonRun;
      return run.perInstruction ?? null;
    } catch {
      return null;
    }
  }
}