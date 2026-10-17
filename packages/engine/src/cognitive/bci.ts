/**
 * BCI-ready seam (PRD §3.2): future EEG/fNIRS devices plug in as adapters
 * and their samples are normalized to the same CognitiveSample the
 * keyboard/mouse collector produces. Registration is explicit; querying an
 * unregistered adapter answers UNSUPPORTED — never a silent fallback.
 */
import type { BciAdapter } from '@revra/contracts';
import type { CognitiveSample } from './types.js';

export interface BciSample {
  adapterId: string;
  /** Device-native cognitive load estimate in [0,1]. */
  loadLevel: number;
  /** Device-native engagement/flow estimate in [0,1]. */
  flowScore: number;
  ts: string;
}

export interface BciAdapterHandle {
  registration: BciAdapter;
  registeredAt: string;
}

export class BciBridge {
  private readonly adapters = new Map<string, BciAdapterHandle>();

  register(registration: BciAdapter, now: string): BciAdapterHandle {
    const handle: BciAdapterHandle = { registration, registeredAt: now };
    this.adapters.set(registration.adapterId, handle);
    return handle;
  }

  list(): BciAdapterHandle[] {
    return [...this.adapters.values()];
  }

  isSupported(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  /**
   * Normalize a device sample to the shared CognitiveSample shape. Bounded
   * guards keep the [0,1] contract even for misbehaving devices.
   */
  normalize(sample: BciSample): CognitiveSample {
    if (!this.isSupported(sample.adapterId)) {
      throw new BciAdapterUnsupported(sample.adapterId);
    }
    return {
      loadLevel: Math.min(1, Math.max(0, sample.loadLevel)),
      flowScore: Math.min(1, Math.max(0, sample.flowScore)),
    };
  }
}

export class BciAdapterUnsupported extends Error {
  constructor(adapterId: string) {
    super(`UNSUPPORTED: no BCI adapter registered with id "${adapterId}"`);
    this.name = 'BciAdapterUnsupported';
  }
}
