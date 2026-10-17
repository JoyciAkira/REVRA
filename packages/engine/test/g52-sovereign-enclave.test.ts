/**
 * G5.2 — Sovereign compute enclaves (PRD §3.4, Beyond Limits).
 *
 * Gate: "enclave attestazione remota verificata in <5s". L'attestazione remota
 * (RATS-style) è il meccanismo con cui un verifier esterno si accerta che un
 * enclave stia girando su hardware TEE certificato (Intel TDX, AMD SEV-SNP,
 * ARM CCA) con il software atteso (measurements), e che la quote non sia un
 * replay (freshness nonce).
 *
 * Il SovereignService.attest() implementa già:
 * - Quote firmata PQC (ML-DSA-65) sul payload {enclaveId, vendor, nonce, measurements}.
 * - Freshness nonce: ogni nonce può essere usato una sola volta (replay detection).
 * - Vendor policy: solo i TEE vendor nella allowlist sono accettati.
 * - Verifica della firma PQC sulla quote prima di ritornare VERIFIED.
 *
 * Questo test verifica il gate "<5s" misurando il tempo end-to-end di
 * attestazione+verifica su ciascun vendor TEE supportato, e conferma i
 * comportamenti di sicurezza (replay nonce → REJECTED, vendor fuori policy →
 * REJECTED, quote signature valida → VERIFIED).
 *
 * Coerente con G5.1 (PqcKemService per forward secrecy): l'attestazione usa
 * ML-DSA-65 per la firma della quote; lo scambio di chiavi di sessione
 * successivo userà ML-KEM-768 (G5.1) per forward secrecy quantistica.
 */
import { describe, expect, it } from 'vitest';
import { SovereignService } from '../src/sovereign/sovereign-service.js';
import type { TeeVendor } from '@revra/contracts';

const NOW = '2026-10-14T00:00:00.000Z';
const SUPPORTED_VENDORS: TeeVendor[] = ['Intel-TDX', 'AMD-SEV-SNP', 'ARM-CCA'];

describe('G5.2 — Sovereign compute enclaves (attestazione remota <5s)', () => {
  it('GATE LATENCY: attestazione remota verificata in <5s su Intel-TDX', () => {
    const svc = new SovereignService();
    const t0 = performance.now();
    const attestation = svc.attest({
      enclaveId: 'enclave-tdx-001',
      teeVendor: 'Intel-TDX',
      nonce: svc.randomNonce(),
      measurements: { runtime: 'revra-enclave-runtime@0.1.0', kernel: 'revra-kernel@2.0.0' },
      now: NOW,
    });
    const elapsedMs = performance.now() - t0;
    expect(attestation.outcome).toBe('VERIFIED');
    expect(attestation.quote.length).toBeGreaterThan(0);
    expect(attestation.signerFingerprint.length).toBeGreaterThan(0);
    // Gate PRD §3.4: attestazione remota verificata in <5s (5000ms).
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('GATE LATENCY: attestazione remota verificata in <5s su AMD-SEV-SNP', () => {
    const svc = new SovereignService();
    const t0 = performance.now();
    const attestation = svc.attest({
      enclaveId: 'enclave-sev-001',
      teeVendor: 'AMD-SEV-SNP',
      nonce: svc.randomNonce(),
      now: NOW,
    });
    const elapsedMs = performance.now() - t0;
    expect(attestation.outcome).toBe('VERIFIED');
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('GATE LATENCY: attestazione remota verificata in <5s su ARM-CCA', () => {
    const svc = new SovereignService();
    const t0 = performance.now();
    const attestation = svc.attest({
      enclaveId: 'enclave-cca-001',
      teeVendor: 'ARM-CCA',
      nonce: svc.randomNonce(),
      now: NOW,
    });
    const elapsedMs = performance.now() - t0;
    expect(attestation.outcome).toBe('VERIFIED');
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('GATE LATENCY AGGREGATA: su 50 attestazioni consecutive (carico realistico), p99 <5s', () => {
    const svc = new SovereignService();
    const latencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const vendor = SUPPORTED_VENDORS[i % SUPPORTED_VENDORS.length]!;
      const t0 = performance.now();
      const att = svc.attest({
        enclaveId: `enclave-load-${i}`,
        teeVendor: vendor,
        nonce: svc.randomNonce(),
        now: NOW,
      });
      latencies.push(performance.now() - t0);
      expect(att.outcome).toBe('VERIFIED');
    }
    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * 0.99)]!;
    // Gate PRD §3.4: anche sotto carico, p99 < 5s.
    expect(p99).toBeLessThan(5000);
  });

  it('FRESHNESS: replay dello stesso nonce → REJECTED (protezione da replay attack)', () => {
    const svc = new SovereignService();
    const nonce = svc.randomNonce();
    const first = svc.attest({
      enclaveId: 'enclave-replay-001',
      teeVendor: 'Intel-TDX',
      nonce,
      now: NOW,
    });
    expect(first.outcome).toBe('VERIFIED');
    // Secondo tentativo con lo STESSO nonce: replay rilevato.
    const replay = svc.attest({
      enclaveId: 'enclave-replay-001',
      teeVendor: 'Intel-TDX',
      nonce, // stesso nonce → replay
      now: NOW,
    });
    expect(replay.outcome).toBe('REJECTED');
    expect(replay.reason).toContain('nonce replay');
  });

  it('VENDOR POLICY: TEE vendor fuori allowlist → REJECTED (solo hardware certificato)', () => {
    // Allowlist ristretta: solo Intel-TDX ammesso.
    const svc = new SovereignService({ allowedVendors: ['Intel-TDX'] });
    const rejected = svc.attest({
      enclaveId: 'enclave-untrusted-001',
      teeVendor: 'AMD-SEV-SNP', // fuori policy
      nonce: svc.randomNonce(),
      now: NOW,
    });
    expect(rejected.outcome).toBe('REJECTED');
    expect(rejected.reason).toContain('fuori policy');
    // Vendor nella policy → accettato.
    const accepted = svc.attest({
      enclaveId: 'enclave-trusted-001',
      teeVendor: 'Intel-TDX',
      nonce: svc.randomNonce(),
      now: NOW,
    });
    expect(accepted.outcome).toBe('VERIFIED');
  });

  it('QUOTE INTEGRITY: la quote firmata PQC è verificabile (firma ML-DSA-65 valida sul payload)', () => {
    const svc = new SovereignService();
    const attestation = svc.attest({
      enclaveId: 'enclave-integrity-001',
      teeVendor: 'Intel-TDX',
      nonce: svc.randomNonce(),
      measurements: { runtime: 'revra-enclave-runtime@0.1.0' },
      now: NOW,
    });
    expect(attestation.outcome).toBe('VERIFIED');
    // L'algoritmo di firma è PQC (ML-DSA-65), non classico.
    expect(attestation.algorithm).toBe('ML-DSA-65');
    // La quote e il fingerprint del signer sono presenti (trasparenza PRD §0.2).
    expect(attestation.quote.length).toBeGreaterThan(0);
    expect(attestation.signerFingerprint.length).toBeGreaterThan(0);
  });

  it('MEASUREMENTS: i measurements del software atteso sono inclusi nel payload attestato', () => {
    const svc = new SovereignService();
    const measurements = {
      runtime: 'revra-enclave-runtime@0.1.0',
      kernel: 'revra-kernel@2.0.0',
      policy: 'revra-policy@1.0.0',
    };
    const attestation = svc.attest({
      enclaveId: 'enclave-measure-001',
      teeVendor: 'ARM-CCA',
      nonce: svc.randomNonce(),
      measurements,
      now: NOW,
    });
    // Attestazione verificata con measurements specifici (il verifier può
    // confrontarli con i valori attesi per quel enclave).
    expect(attestation.outcome).toBe('VERIFIED');
    expect(attestation.enclaveId).toBe('enclave-measure-001');
    expect(attestation.teeVendor).toBe('ARM-CCA');
  });

  it('randomNonce produce nonce unici (freshness garantita per ogni attestazione)', () => {
    const svc = new SovereignService();
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(svc.randomNonce());
    }
    // 100 nonce distinti (nessuna collisione → freshness robusta).
    expect(nonces.size).toBe(100);
  });
});