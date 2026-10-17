/**
 * A1: Proof caching layer for Lean4CliVerifier.
 * Caches verification outcomes by hash(theorem + semanticModel + proofTerm)
 * to avoid re-running lean on identical proofs (mitigates PRD §10 overhead risk).
 */
import { createHash } from 'node:crypto';
import type { CertificateInput, VerifierRun } from './types.js';

interface CacheEntry {
  outcome: VerifierRun;
  cachedAt: number;
}

export class ProofCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = 3600_000) {
    // Default TTL: 1 hour
    this.ttlMs = ttlMs;
  }

  private key(cert: CertificateInput): string {
    const payload = `${cert.theorem}|${cert.semanticModel}|${cert.proofTerm}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  get(cert: CertificateInput): VerifierRun | undefined {
    const k = this.key(cert);
    const entry = this.cache.get(k);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(k);
      return undefined;
    }
    return entry.outcome;
  }

  set(cert: CertificateInput, outcome: VerifierRun): void {
    const k = this.key(cert);
    this.cache.set(k, { outcome, cachedAt: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}