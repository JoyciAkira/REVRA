/**
 * Universal coverage seam (visione founder): detection reale dai magic
 * bytes per 9 ecosistemi, routing con capability dichiarate (SUPPORTED /
 * DEGRADED / PLANNED / UNSUPPORTED — mai silenziosi), pipeline che
 * consegna l'analisi al kernel con provenance engine.
 */
import { describe, expect, it } from 'vitest';
import type { BinaryEcosystem, FormatDetection } from '@revra/contracts';
import { EvidenceKernel } from '@revra/kernel';
import { detectFormat } from '../src/formats/format-detector.js';
import { FormatEngineRegistry } from '../src/formats/engine-registry.js';
import { UniversalAnalysisPipeline } from '../src/formats/universal-pipeline.js';
import type { FormatEngineAdapter, FormatAnalysisInput, FormatAnalysisOutput } from '../src/formats/adapters.js';

function bytes(...parts: Array<number | string>): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(part);
  }
  return new Uint8Array(out);
}

const FIXTURES: Array<{ ecosystem: BinaryEcosystem; bytes: Uint8Array }> = [
  { ecosystem: 'native-elf', bytes: bytes(0x7f, 'ELF', 0x02, 0x01, 0x01) },
  { ecosystem: 'native-pe', bytes: bytes('MZ', 0x90, 0x00, 0x03) },
  { ecosystem: 'dotnet', bytes: bytes('MZ', 0x90, 0x00, 0x03, 0, 0, 0, 0, 'BSJB-padded-metadata') },
  { ecosystem: 'native-mach-o', bytes: bytes(0xfe, 0xed, 0xfa, 0xce) },
  { ecosystem: 'jvm', bytes: bytes('PK\x03\x04', 0x14, 0x00, 'META-INF/MANIFEST.MF...') },
  { ecosystem: 'python', bytes: bytes(0xcb, 0x0d, 0x0d, 0x0a, 0x00) },
  { ecosystem: 'javascript-asar', bytes: bytes(0x04, 0, 0, 0, 0x20, 0, 0, 0, 0x15, 0, 0, 0, '{') },
  { ecosystem: 'wasm', bytes: bytes(0x00, 'asm', 0x01, 0x00) },
  { ecosystem: 'firmware', bytes: bytes(0x27, 0x05, 0x19, 0x56) },
];

describe('detectFormat', () => {
  it('identifies every ecosystem in the universal matrix from its magic bytes', () => {
    for (const fixture of FIXTURES) {
      const detection = detectFormat(fixture.bytes);
      expect(detection, fixture.ecosystem).not.toBeNull();
      expect(detection!.ecosystem).toBe(fixture.ecosystem);
      expect(detection!.confidence).toBeGreaterThan(0.5);
      expect(detection!.magicEvidence.length).toBeGreaterThan(0);
    }
  });

  it('returns null for unknown formats — never an invented label', () => {
    expect(detectFormat(bytes(0x13, 0x37, 0x13, 0x37))).toBeNull();
    // ZIP generico senza META-INF: fuori matrice, dichiarato non riconosciuto.
    expect(detectFormat(bytes('PK\x03\x04', 0x14, 0x00, 'data-only'))).toBeNull();
  });

  it('separates native PE from .NET (CLR metadata)', () => {
    const pe = detectFormat(FIXTURES[1]!.bytes)!;
    const dotnet = detectFormat(FIXTURES[2]!.bytes)!;
    expect(pe.ecosystem).toBe('native-pe');
    expect(dotnet.ecosystem).toBe('dotnet');
  });
});

class StaticAdapter {
  readonly engineId: string;
  readonly engineVersion = '0.0.0';
  constructor(
    readonly ecosystem: BinaryEcosystem,
    private readonly available: boolean,
    private readonly findings = 'fake findings',
  ) {
    this.engineId = `fake-${ecosystem}`;
  }
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async analyze(input: FormatAnalysisInput): Promise<FormatAnalysisOutput> {
    return {
      claim: {
        kind: 'format-analysis',
        payload: { engine: this.engineId, findings: this.findings, format: input.detection.format },
      },
      warnings: [],
    };
  }
}

describe('FormatEngineRegistry', () => {
  it('routes to the available engine: SUPPORTED with proof of availability', async () => {
    const registry = new FormatEngineRegistry();
    registry.register(new StaticAdapter('native-elf', true) as FormatEngineAdapter);

    const decision = await registry.route(detectFormat(FIXTURES[0]!.bytes) as FormatDetection);

    expect(decision.status).toBe('SUPPORTED');
    expect(decision.engineId).toBe('fake-native-elf');
  });

  it('declares DEGRADED when the engine is registered but not installed', async () => {
    const registry = new FormatEngineRegistry();
    registry.register(new StaticAdapter('jvm', false) as FormatEngineAdapter);

    const decision = await registry.route(detectFormat(FIXTURES[4]!.bytes) as FormatDetection);

    expect(decision.status).toBe('DEGRADED');
    expect(decision.reason).toMatch(/disponibile su PATH/);
  });

  it('declares PLANNED for ecosystems with no engine registered yet', async () => {
    const registry = new FormatEngineRegistry();

    const decision = await registry.route(detectFormat(FIXTURES[7]!.bytes) as FormatDetection);

    expect(decision.status).toBe('PLANNED');
    expect(decision.reason).toMatch(/roadmap/);
  });

  it('builds the live coverage matrix from availability probes', async () => {
    const registry = new FormatEngineRegistry();
    registry.register(new StaticAdapter('native-elf', true) as FormatEngineAdapter, 'bench://elf-parity');

    const matrix = await registry.coverageMatrix('2026-10-11T00:00:00.000Z');

    expect(matrix.rows.filter((r) => r.ecosystem === 'native-elf')[0]!.status).toBe('SUPPORTED');
    expect(matrix.rows.filter((r) => r.ecosystem === 'wasm')[0]!.status).toBe('PLANNED');
    expect(matrix.rows).toHaveLength(9);
  });
});

describe('UniversalAnalysisPipeline', () => {
  it('detects, routes, analyzes and records the result in the kernel with engine provenance', async () => {
    const kernel = new EvidenceKernel();
    const registry = new FormatEngineRegistry();
    registry.register(new StaticAdapter('jvm', true) as FormatEngineAdapter);
    const pipeline = new UniversalAnalysisPipeline({ kernel, registry });

    const report = await pipeline.analyze({
      bytes: FIXTURES[4]!.bytes,
      binaryHash: 'a1b2c3d4e5f60718',
    });

    expect(report.detection?.ecosystem).toBe('jvm');
    expect(report.routing.status).toBe('SUPPORTED');
    expect(report.result?.engineSource).toBe('fake-jvm@0.0.0');
    expect(report.result?.claim.kind).toBe('format-analysis');
    // Engine actor su claim di analisi → L1 (gerarchia del kernel imposta).
    expect(report.result?.verification.state).toBe('L1');
  });

  it('reports UNSUPPORTED for unrecognized bytes without creating any result', async () => {
    const kernel = new EvidenceKernel();
    const registry = new FormatEngineRegistry();
    const pipeline = new UniversalAnalysisPipeline({ kernel, registry });

    const report = await pipeline.analyze({ bytes: bytes(0x13, 0x37, 0x13, 0x37), binaryHash: 'a1b2c3d4e5f60718' });

    expect(report.routing.status).toBe('UNSUPPORTED');
    expect(report.result).toBeUndefined();
    expect(kernel.listResults()).toHaveLength(0);
  });
});
