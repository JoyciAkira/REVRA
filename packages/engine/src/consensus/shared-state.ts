/**
 * Shared Formal State (PRD §3.1): engines share verified claims, not just
 * data. Append-only, versioned — an engine can sync from any version.
 */
import type { AddressRange, Claim } from '@revra/contracts';

export interface SharedFormalEntry {
  version: number;
  claimHash: string;
  claim: Claim;
  binaryHash: string;
  addressRange: AddressRange;
  sourceEngines: string[];
  ts: string;
}

export interface SharedFormalSnapshot {
  version: number;
  entries: SharedFormalEntry[];
}

export class SharedFormalState {
  private entries: SharedFormalEntry[] = [];

  get version(): number {
    return this.entries.length;
  }

  publish(
    input: {
      claimHash: string;
      claim: Claim;
      binaryHash: string;
      addressRange: AddressRange;
      sourceEngines: string[];
    },
    now: string,
  ): SharedFormalEntry {
    const entry: SharedFormalEntry = { version: this.entries.length + 1, ...input, ts: now };
    this.entries.push(entry);
    return entry;
  }

  /** Entries published after the given version (delta sync for engines). */
  since(version: number): SharedFormalEntry[] {
    return this.entries.filter((e) => e.version > version);
  }

  snapshot(): SharedFormalSnapshot {
    return { version: this.version, entries: [...this.entries] };
  }
}
