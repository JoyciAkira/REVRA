/**
 * Adapter di analisi per ecosistema (PRD §3.1: i motori sono componenti
 * interni). Ogni adapter dichiara la sua disponibilità a runtime (probe del
 * binario CLI) e produce un claim nel formato del kernel. Un tool assente
 * NON è un errore: è uno stato di capability dichiarato (DEGRADED).
 */
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AddressRange, BinaryEcosystem, Claim } from '@revra/contracts';

const execFileAsync = promisify(execFile);

export interface FormatAnalysisInput {
  bytes: Uint8Array;
  binaryHash: string;
  addressRange: AddressRange;
  detection: { ecosystem: BinaryEcosystem; format: string };
}

export interface FormatAnalysisOutput {
  claim: Claim;
  warnings: string[];
}

export interface FormatEngineAdapter {
  readonly ecosystem: BinaryEcosystem;
  readonly engineId: string;
  readonly engineVersion: string;
  /** Probe del tool: false = capability DEGRADED (dichiarata, mai nascosta). */
  isAvailable(): Promise<boolean>;
  analyze(input: FormatAnalysisInput): Promise<FormatAnalysisOutput>;
}

/** Presenza del tool CLI su PATH — il probe è il limite del nostro onestissimo runtime. */
export async function hasCliBinary(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

function wrapStdout(engineId: string, ecosystem: BinaryEcosystem, format: string, stdout: string): FormatAnalysisOutput {
  const output = stdout.trim();
  return {
    claim: {
      kind: 'format-analysis',
      payload: {
        engine: engineId,
        ecosystem,
        format,
        findings: output.slice(0, 4000),
        observedBytes: output.length,
      },
    },
    warnings: output.length === 0 ? ['ENGINE_EMPTY_OUTPUT'] : [],
  };
}

function cliError(engineId: string, error: unknown): FormatAnalysisOutput {
  const message = error instanceof Error ? error.message : String(error);
  return {
    claim: {
      kind: 'format-analysis',
      payload: { engine: engineId, findings: message.slice(0, 2000), failed: true },
    },
    warnings: ['ENGINE_RUN_FAILED'],
  };
}

/** Factory per adapter CLI "quick probe": esegue il tool in modalità rapida sul file. */
export function cliAdapter(options: {
  ecosystem: BinaryEcosystem;
  engineId: string;
  engineVersion: string;
  command: string;
  versionArgs?: string[];
  /** Argomenti: {file} è sostituito dal path del file temporaneo. */
  quickArgs: string[];
  /** Timeout esecuzione (default 30s; ghidra 180s per la JVM + analysis). */
  timeoutMs?: number;
  /** Directory da creare prima dell'esecuzione (es. project dir di ghidra). */
  preCreateDirs?: string[];
}): FormatEngineAdapter {
  const versionArgs = options.versionArgs ?? ['--version'];
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    ecosystem: options.ecosystem,
    engineId: options.engineId,
    engineVersion: options.engineVersion,
    async isAvailable(): Promise<boolean> {
      return hasCliBinary(options.command);
    },
    async analyze(input: FormatAnalysisInput): Promise<FormatAnalysisOutput> {
      for (const dir of options.preCreateDirs ?? []) {
        mkdirSync(dir, { recursive: true });
      }
      const dir = await mkdtemp(join(tmpdir(), 'revra-engine-'));
      const file = join(dir, `binary.${input.detection.format}`);
      try {
        await writeFile(file, input.bytes);
        const args = options.quickArgs.map((a) => (a === '{file}' ? file : a));
        const { stdout } = await execFileAsync(options.command, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
        return wrapStdout(options.engineId, options.ecosystem, input.detection.format, stdout);
      } catch (error) {
        return cliError(options.engineId, error);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Registry di default: la matrice universale con i motori best-of-breed per
 * ecosistema. Se il tool non è sul PATH, la capability è DEGRADED con
 * reason esplicita — l'installazione è un'azione di deployment, non codice.
 */
export function defaultAdapters(): FormatEngineAdapter[] {
  return [
    cliAdapter({
      ecosystem: 'native-elf',
      engineId: 'ghidra-headless',
      engineVersion: 'system',
      command: 'analyzeHeadless',
      versionArgs: ['-version'],
      timeoutMs: 180_000,
      preCreateDirs: ['/tmp/revra-ghidra-proj'],
      quickArgs: ['/tmp/revra-ghidra-proj', 'revra', '-import', '{file}', '-deleteProject'],
    }),
    cliAdapter({
      ecosystem: 'native-elf',
      engineId: 'radare2',
      engineVersion: 'system',
      command: 'r2',
      versionArgs: ['-v'],
      quickArgs: ['-q', '-c', 'ie; afl', '{file}'],
    }),
    cliAdapter({
      ecosystem: 'native-pe',
      engineId: 'radare2',
      engineVersion: 'system',
      command: 'r2',
      quickArgs: ['-q', '-c', 'ie; afl', '{file}'],
    }),
    cliAdapter({
      ecosystem: 'native-mach-o',
      engineId: 'radare2',
      engineVersion: 'system',
      command: 'r2',
      quickArgs: ['-q', '-c', 'ie; afl', '{file}'],
    }),
    cliAdapter({
      ecosystem: 'jvm',
      engineId: 'jadx',
      engineVersion: 'system',
      command: 'jadx',
      versionArgs: ['--version'],
      quickArgs: ['--list-classes', '{file}'],
    }),
    cliAdapter({
      ecosystem: 'dotnet',
      engineId: 'ilspycmd',
      engineVersion: 'system',
      command: 'ilspycmd',
      versionArgs: ['--version'],
      quickArgs: ['--list', '{file}'],
    }),
    cliAdapter({
      ecosystem: 'python',
      engineId: 'pycdc',
      engineVersion: 'system',
      command: 'pycdc',
      quickArgs: ['{file}'],
    }),
    cliAdapter({
      ecosystem: 'javascript-asar',
      engineId: 'asar-cli',
      engineVersion: 'system',
      command: 'asar',
      versionArgs: ['--version'],
      quickArgs: ['list', '{file}'],
    }),
    cliAdapter({
      ecosystem: 'wasm',
      engineId: 'wasm2wat',
      engineVersion: 'system',
      command: 'wasm2wat',
      quickArgs: ['{file}'],
    }),
    cliAdapter({
      ecosystem: 'firmware',
      engineId: 'binwalk',
      engineVersion: 'system',
      command: 'binwalk',
      versionArgs: ['--help'],
      quickArgs: ['{file}'],
    }),
   // B4: adapter UPX unpacking — estrae il binario originale da ELF/PE packed.
   // Trasversale: registrato su native-elf e native-pe (i due ecosistemi che UPX supporta).
   // Se upx non è sul PATH → DEGRADED dichiarato (come gli altri adapter).
   cliAdapter({
     ecosystem: 'native-elf',
     engineId: 'upx-unpacker',
     engineVersion: 'system',
     command: 'upx',
     versionArgs: ['--version'],
     timeoutMs: 60_000,
     quickArgs: ['-d', '{file}', '-o', '{file}.unpacked'],
   }),
   cliAdapter({
     ecosystem: 'native-pe',
     engineId: 'upx-unpacker',
     engineVersion: 'system',
     command: 'upx',
     versionArgs: ['--version'],
     timeoutMs: 60_000,
     quickArgs: ['-d', '{file}', '-o', '{file}.unpacked'],
   }),
  ];
}
