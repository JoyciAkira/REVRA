/**
 * B1 — Volumetric holographic visualization stub (PRD §3.2, §9 Volumetric
 * Rendering Pipeline). WebGPU Compute Shaders per raymarching volumetrico di
 * CFG/memory/dataflow come Signed Distance Field.
 *
 * Progressive enhancement (mitiga rischio PRD §10 "volumetric troppo pesante
 * per browser"): se WebGPU non è disponibile o l'hardware è incapace, il
 * renderer degrada IMMEDIATAMENTE a fallback 2D — mai un crash, mai un blank.
 * L'attivazione volumetrica è opt-in e capability-gated.
 *
 * Questo è uno stub di architettura (seam + decisione di fallback + contratto
 * di rendering), non un renderer WebGPU completo: il raymarching reale vive
 * nel track B1.2 della roadmap. Il gate B1 qui è: la decisione di fallback è
 * deterministica, misurabile, e il contratto di rendering è onesto sullo stato.
 */

export type VolumetricBackend = 'webgpu' | 'fallback-2d';

export interface VolumetricCapabilities {
  /** Backend effettivamente selezionato dopo il probe di capability. */
  backend: VolumetricBackend;
  /** Perché è stato scelto quel backend (prova onesta, PRD §0 evidence). */
  reason: string;
  /** WebGPU disponibile ma non attivato (es. opt-in mancante / hardware debole). */
  webgpuAvailable: boolean;
  /** Numero massimo di nodi CFG gestibili interattivamente col backend scelto. */
  maxInteractiveNodes: number;
}

export interface VolumetricRenderRequest {
  /** Nodi del CFG da renderizzare (posizione + connessioni). */
  nodeCount: number;
  /** Se forzare il fallback 2D indipendentemente dalla capability. */
  force2d?: boolean;
}

export interface VolumetricRenderDecision {
  backend: VolumetricBackend;
  /** Tempo stimato/osservato di preparazione del frame (ms). */
  prepMs: number;
  /** Nota onesta sullo stato del rendering. */
  note: string;
}

/**
 * Probe di capability WebGPU. Ritorna true solo se `navigator.gpu` esiste e
 * `requestAdapter()` risolve un adapter valido. In ambienti senza WebGPU
 * (Node, browser vecchi, headless) ritorna false → fallback 2D.
 *
 * `gpuRequestAdapter` è iniettato per testabilità (in produzione è
 * `navigator.gpu.requestAdapter.bind(navigator.gpu)`).
 */
export async function probeWebGpu(
  gpuRequestAdapter?: () => Promise<unknown | null>,
): Promise<{ available: boolean; reason: string }> {
  if (!gpuRequestAdapter) {
    return { available: false, reason: 'WebGPU API non presente in questo ambiente' };
  }
  try {
    const adapter = await gpuRequestAdapter();
    if (!adapter) {
      return { available: false, reason: 'nessun adapter GPU disponibile (hardware incapace o headless)' };
    }
    return { available: true, reason: 'adapter WebGPU disponibile' };
  } catch (error) {
    return {
      available: false,
      reason: `probe WebGPU fallito: ${error instanceof Error ? error.message : 'errore sconosciuto'}`,
    };
  }
}

export class VolumetricRenderer {
  private readonly capabilities: VolumetricCapabilities;

  private constructor(capabilities: VolumetricCapabilities) {
    this.capabilities = capabilities;
  }

  /**
   * Decide il backend una sola volta all'inizializzazione: probe WebGPU +
   * policy di progressive enhancement. Fallback 2D immediato se WebGPU manca.
   */
  static async create(
    options: { preferWebGpu?: boolean; gpuRequestAdapter?: () => Promise<unknown | null> } = {},
  ): Promise<VolumetricRenderer> {
    const probe = await probeWebGpu(options.gpuRequestAdapter);
    const useWebGpu = Boolean(options.preferWebGpu) && probe.available;
    const capabilities: VolumetricCapabilities = {
      backend: useWebGpu ? 'webgpu' : 'fallback-2d',
      reason: useWebGpu
        ? 'WebGPU disponibile e opt-in attivo'
        : probe.available
          ? 'WebGPU disponibile ma non attivato (preferWebGpu=false o opt-in mancante)'
          : probe.reason,
      webgpuAvailable: probe.available,
      // Stima conservativa: WebGPU gestisce CFG grandi; fallback 2D scala linearmente.
      maxInteractiveNodes: useWebGpu ? 10_000 : 1_000,
    };
    return new VolumetricRenderer(capabilities);
  }

  getCapabilities(): VolumetricCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Decide come renderizzare una richiesta: rispetta force2d, il limite di
   * nodi interattivi del backend, e riporta onestamente lo stato (PRD §0).
   */
  decideRender(request: VolumetricRenderRequest): VolumetricRenderDecision {
    const t0 = performance.now();
    const forced2d = request.force2d === true;
    const overBudget = request.nodeCount > this.capabilities.maxInteractiveNodes;
    let backend: VolumetricBackend = this.capabilities.backend;
    let note: string;

    if (forced2d) {
      backend = 'fallback-2d';
      note = 'fallback 2D forzato dalla richiesta';
    } else if (this.capabilities.backend === 'fallback-2d') {
      note = overBudget
        ? `fallback 2D: ${request.nodeCount} nodi oltre budget interattivo (${this.capabilities.maxInteractiveNodes}) — rendering progressivo`
        : 'fallback 2D progressivo (WebGPU non disponibile)';
    } else if (overBudget) {
      // Progressive enhancement: anche con WebGPU, oltre il budget si degrada a 2D.
      backend = 'fallback-2d';
      note = `WebGPU oltre budget interattivo (${request.nodeCount} > ${this.capabilities.maxInteractiveNodes}) — degradazione progressiva a 2D`;
    } else {
      note = `WebGPU volumetric raymarching (${request.nodeCount} nodi)`;
    }

    return { backend, prepMs: performance.now() - t0, note };
  }
}