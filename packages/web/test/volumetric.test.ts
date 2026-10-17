/**
* B1 — Volumetric holographic visualization (PRD §3.2, §9).
* Gate: fallback 2D IMMEDIATO e deterministico quando WebGPU manca (mitiga
* rischio PRD §10 "volumetric troppo pesante"); progressive enhancement
* onesto sullo stato del backend; budget di nodi interattivi rispettato.
*/
import { describe, expect, it } from 'vitest';
import { VolumetricRenderer, probeWebGpu } from '../src/cognitive/volumetric.js';

describe('B1 — Volumetric renderer: fallback 2D progressivo', () => {
  it('senza WebGPU (ambiente Node/headless) → fallback-2d immediato, mai crash', async () => {
    // Nessun gpuRequestAdapter fornito = WebGPU non presente.
    const renderer = await VolumetricRenderer.create();
    const caps = renderer.getCapabilities();
    expect(caps.backend).toBe('fallback-2d');
    expect(caps.webgpuAvailable).toBe(false);
    expect(caps.reason).toContain('non presente');
    // Il fallback gestisce fino a 1k nodi interattivi (stima conservativa).
    expect(caps.maxInteractiveNodes).toBeGreaterThanOrEqual(1_000);
  });

  it('probe WebGPU: adapter null → non disponibile con reason onesta', async () => {
    const probe = await probeWebGpu(async () => null);
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain('nessun adapter');
  });

  it('probe WebGPU: adapter valido + preferWebGpu → backend webgpu', async () => {
    const fakeAdapter = {};
    const renderer = await VolumetricRenderer.create({
      preferWebGpu: true,
      gpuRequestAdapter: async () => fakeAdapter,
    });
    const caps = renderer.getCapabilities();
    expect(caps.backend).toBe('webgpu');
    expect(caps.webgpuAvailable).toBe(true);
    expect(caps.maxInteractiveNodes).toBeGreaterThanOrEqual(10_000);
  });

  it('WebGPU disponibile ma preferWebGpu=false → fallback-2d (opt-in rispettato)', async () => {
    const renderer = await VolumetricRenderer.create({
      preferWebGpu: false,
      gpuRequestAdapter: async () => ({}),
    });
    expect(renderer.getCapabilities().backend).toBe('fallback-2d');
  });

  it('decideRender: force2d forza il fallback indipendentemente dal backend', async () => {
    const renderer = await VolumetricRenderer.create({
      preferWebGpu: true,
      gpuRequestAdapter: async () => ({}),
    });
    const decision = renderer.decideRender({ nodeCount: 100, force2d: true });
    expect(decision.backend).toBe('fallback-2d');
    expect(decision.note).toContain('forzato');
  });

  it('decideRender: oltre il budget interattivo → degradazione progressiva a 2D', async () => {
    const renderer = await VolumetricRenderer.create({
      preferWebGpu: true,
      gpuRequestAdapter: async () => ({}),
    });
    const caps = renderer.getCapabilities();
    const decision = renderer.decideRender({ nodeCount: caps.maxInteractiveNodes + 1 });
    expect(decision.backend).toBe('fallback-2d');
    expect(decision.note).toContain('degradazione progressiva');
  });

  it('decideRender: entro budget con WebGPU → raymarching volumetric', async () => {
    const renderer = await VolumetricRenderer.create({
      preferWebGpu: true,
      gpuRequestAdapter: async () => ({}),
    });
    const decision = renderer.decideRender({ nodeCount: 500 });
    expect(decision.backend).toBe('webgpu');
    expect(decision.note).toContain('raymarching');
  });

  it('probe WebGPU che lancia eccezione → non disponibile, nessun throw', async () => {
    const probe = await probeWebGpu(async () => {
      throw new Error('GPU context lost');
    });
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain('GPU context lost');
  });
});