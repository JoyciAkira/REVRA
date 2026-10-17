/**
 * Scena volumetrica: mapping puro risultati → punti 3D (deterministico,
 * indipendente da DOM/GPU — il renderer applica la scena così com'è).
 */
import type { AnalysisResult } from '@revra/contracts';
import { describe, expect, it } from 'vitest';
import { buildScene } from '../src/volumetric/scene.js';

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: 'res-1',
    binaryHash: 'a1b2c3d4e5f60718',
    arch: 'x86_64',
    addressRange: { start: '0x401000', end: '0x4010ff' },
    engineSource: 'ghidra',
    claim: { kind: 'decompilation', payload: {} },
    verification: { state: 'L1', warnings: [] },
    provenance: [{ id: 'e1', ts: '2026-10-11T00:00:01.000Z', actor: { kind: 'ai', id: 'p' }, action: 'submit', toState: 'L1' }],
    ...overrides,
  };
}

describe('buildScene', () => {
  it('maps evidence level to the y axis and intensity', () => {
    const scene = buildScene([
      result({ id: 'a', verification: { state: 'L1', warnings: [] } }),
      result({
        id: 'b',
        addressRange: { start: '0x402000', end: '0x4020ff' },
        verification: { state: 'L3', warnings: [] },
      }),
    ]);

    expect(scene).toHaveLength(2);
    expect(scene[0]!.y).toBe(1);
    expect(scene[1]!.y).toBe(3);
    expect(scene[1]!.intensity).toBe(1);
    expect(scene[0]!.intensity).toBe(0.45);
  });

  it('orders x by address and z by arrival time, normalized to [0,1]', () => {
    const scene = buildScene([
      result({
        id: 'late',
        addressRange: { start: '0x500000', end: '0x5000ff' },
        provenance: [{ id: 'e9', ts: '2026-10-11T00:00:09.000Z', actor: { kind: 'ai', id: 'p' }, action: 'submit', toState: 'L1' }],
      }),
      result({
        id: 'early-low',
        addressRange: { start: '0x400000', end: '0x4000ff' },
        provenance: [{ id: 'e0', ts: '2026-10-11T00:00:00.000Z', actor: { kind: 'ai', id: 'p' }, action: 'submit', toState: 'L1' }],
      }),
    ]);

    // early-low ha indirizzo più basso → x=0; è anche il primo arrivato → z=0.
    expect(scene[0]!.resultId).toBe('early-low');
    expect(scene[0]!.x).toBe(0);
    expect(scene[0]!.z).toBe(0);
    expect(scene[1]!.x).toBe(1);
    expect(scene[1]!.z).toBe(1);
  });

  it('places special states between levels', () => {
    const scene = buildScene([
      result({ verification: { state: 'DISPUTED', warnings: [] } }),
    ]);
    expect(scene[0]!.y).toBe(2.5);
  });
});
