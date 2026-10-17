/**
 * FormatEngineRegistry (PRD §3.1, matrice universale): registra gli adapter
 * per ecosistema e deriva la capability matrix dai FATTI — il probe di
 * disponibilità dei tool decide SUPPORTED/DEGRADED, l'assenza di adapter
 * dichiara PLANNED. La matrice si genera dal runtime, non da un documento.
 */
import type {
  Capability,
  CapabilityStatus,
  CoverageMatrix,
  FormatDetection,
  RoutingDecision,
} from '@revra/contracts';
import { BINARY_ECOSYSTEMS } from '@revra/contracts';
import type { BinaryEcosystem } from '@revra/contracts';
import type { FormatEngineAdapter } from './adapters.js';

export interface RegisteredAdapter {
  adapter: FormatEngineAdapter;
  benchmarkRef?: string;
}

export interface UniversalAnalysisPipelineInput {
  bytes: Uint8Array;
  binaryHash: string;
  addressRange: import('@revra/contracts').AddressRange;
}

export class FormatEngineRegistry {
  private readonly byEcosystem = new Map<BinaryEcosystem, RegisteredAdapter[]>();

  /** Ordine di registrazione = ordine di preferenza nel routing. */
  register(adapter: FormatEngineAdapter, benchmarkRef?: string): void {
    const list = this.byEcosystem.get(adapter.ecosystem) ?? [];
    list.push({ adapter, benchmarkRef });
    this.byEcosystem.set(adapter.ecosystem, list);
  }

  adaptersFor(ecosystem: BinaryEcosystem): RegisteredAdapter[] {
    return [...(this.byEcosystem.get(ecosystem) ?? [])];
  }

  private async capabilityFor(entry: RegisteredAdapter): Promise<Capability> {
    const available = await entry.adapter.isAvailable();
    const status: CapabilityStatus = available ? 'SUPPORTED' : 'DEGRADED';
    return {
      ecosystem: entry.adapter.ecosystem,
      engineId: entry.adapter.engineId,
      engineVersion: entry.adapter.engineVersion,
      status,
      benchmarkRef: entry.benchmarkRef,
      reason: available
        ? entry.benchmarkRef
          ? `parity provata: ${entry.benchmarkRef}`
          : 'tool disponibile; benchmark parity in attesa (richiesto per best-in-world)'
        : `tool "${entry.adapter.engineId}" non presente su PATH — installalo per abilitare l'ecosistema`,
    };
  }

  /**
   * Routing: primo adapter DISPONIBILE per l'ecosistema rilevato.
   * Nessun adapter registrato → PLANNED (in roadmap); registrati ma assenti →
   * DEGRADED. Il binario non riconosciuto → UNSUPPORTED con la prova.
   */
  async route(detection: FormatDetection | null): Promise<RoutingDecision> {
    if (!detection) {
      return {
        detection: {
          ecosystem: 'native-elf',
          format: 'unknown',
          confidence: 0,
          magicEvidence: 'nessuna firma conosciuta nei magic bytes',
        },
        engineId: null,
        status: 'UNSUPPORTED',
        reason: 'formato non riconosciuto dalla matrice di copertura',
      };
    }
    const candidates = this.adaptersFor(detection.ecosystem);
    if (candidates.length === 0) {
      return {
        detection,
        engineId: null,
        status: 'PLANNED',
        reason: `ecosistema ${detection.ecosystem} in roadmap: nessun engine registrato`,
      };
    }
    for (const entry of candidates) {
      if (await entry.adapter.isAvailable()) {
        return { detection, engineId: entry.adapter.engineId, status: 'SUPPORTED' };
      }
    }
    return {
      detection,
      engineId: null,
      status: 'DEGRADED',
      reason: `ecosistema ${detection.ecosystem}: engine registrati (${candidates
        .map((c) => c.adapter.engineId)
        .join(', ')}) ma nessuno disponibile su PATH`,
    };
  }

  /** Coverage matrix LIVE: generata dai probe di disponibilità correnti. */
  async coverageMatrix(now: string): Promise<CoverageMatrix> {
    const rows: CoverageMatrix['rows'] = [];
    for (const ecosystem of BINARY_ECOSYSTEMS) {
      const entries = this.adaptersFor(ecosystem);
      if (entries.length === 0) {
        rows.push({ ecosystem, engineId: '—', status: 'PLANNED', reason: 'nessun engine registrato' });
        continue;
      }
      for (const entry of entries) {
        const capability = await this.capabilityFor(entry);
        rows.push({
          ecosystem,
          engineId: capability.engineId,
          status: capability.status,
          reason: capability.reason,
          benchmarkRef: capability.benchmarkRef,
        });
      }
    }
    return { generatedAt: now, rows };
  }

  /** Primo adapter disponibile per l'ecosistema rilevato, o null (dichiarato). */
  async resolveAvailable(detection: FormatDetection): Promise<FormatEngineAdapter | null> {
    for (const entry of this.adaptersFor(detection.ecosystem)) {
      if (await entry.adapter.isAvailable()) return entry.adapter;
    }
    return null;
  }
}
