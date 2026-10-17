/**
 * B3 — G6 Sovereign Enclave verificabile (PRD §3.4, §6.4).
 * Gate: remote attestation RATS multi-vendor (TDX/SEV-SNP/CCA) con freshness
 * nonce; ZKP compliance circuit che dimostra proprietà senza rivelare il log
 * interno (audit <1h target PRD §6.4, qui misurato in ms); dual-stack PQC
 * hybrid certificates per interoperabilità durante la transizione quantistica
 * (mitiga rischio PRD §10 "PQC migration rompe legacy").
 */
import { describe, expect, it } from 'vitest';
import {
  SovereignService,
  NO_CLASSIFIED_EGRESS_CIRCUIT,
} from '../src/sovereign/sovereign-service.js';

const NOW = '2026-10-12T00:00:00.000Z';

describe('B3 — Remote attestation RATS multi-vendor', () => {
  it('attestazione VERIFIED per vendor nella policy (TDX/SEV-SNP/CCA/simulated)', () => {
    const svc = new SovereignService();
    const vendors = ['Intel-TDX', 'AMD-SEV-SNP', 'ARM-CCA', 'software-simulated'] as const;
    for (const vendor of vendors) {
      const att = svc.attest({
        enclaveId: `enclave-${vendor}`,
        teeVendor: vendor,
        nonce: svc.randomNonce(),
        now: NOW,
      });
      expect(att.outcome, `vendor ${vendor} dovrebbe essere VERIFIED`).toBe('VERIFIED');
      expect(att.teeVendor).toBe(vendor);
      expect(att.quote.length).toBeGreaterThan(0); // quote firmata PQC presente
    }
  });

  it('attestazione REJECTED per vendor fuori policy (portabilità multi-vendor onesta)', () => {
    const svc = new SovereignService({ allowedVendors: ['Intel-TDX'] });
    const att = svc.attest({
      enclaveId: 'enclave-rejected',
      teeVendor: 'AMD-SEV-SNP', // non nella allowlist ristretta
      nonce: svc.randomNonce(),
      now: NOW,
    });
    expect(att.outcome).toBe('REJECTED');
    expect(att.reason).toContain('fuori policy');
  });

  it('nonce replay REJECTED: freshness dimostrata (attestation replay non passa)', () => {
    const svc = new SovereignService();
    const nonce = svc.randomNonce();
    const first = svc.attest({ enclaveId: 'e1', teeVendor: 'Intel-TDX', nonce, now: NOW });
    expect(first.outcome).toBe('VERIFIED');
    const replay = svc.attest({ enclaveId: 'e2', teeVendor: 'Intel-TDX', nonce, now: NOW });
    expect(replay.outcome).toBe('REJECTED');
    expect(replay.reason).toContain('nonce replay');
  });

  it('attestazione rapida: <5s target PRD §6.4 (qui ms su PQC software)', () => {
    const svc = new SovereignService();
    const t0 = performance.now();
    const att = svc.attest({
      enclaveId: 'enclave-perf',
      teeVendor: 'software-simulated',
      nonce: svc.randomNonce(),
      now: NOW,
    });
    const elapsed = performance.now() - t0;
    expect(att.outcome).toBe('VERIFIED');
    // Gate PRD §6.4: remote attestation verificabile in <5s.
    expect(elapsed).toBeLessThan(5_000);
  });
});

describe('B3 — ZKP compliance circuit (simulatore onesto, PRD §3.4/§9)', () => {
  it('circuito no-classified-egress: satisfied quando egressLevel <= maxEgress', () => {
    const svc = new SovereignService();
    const result = svc.runZkpCompliance({
      enclaveId: 'enclave-zkp',
      circuitName: 'no-classified-egress',
      internalLog: [
        { egressLevel: 0, data: 'public' },
        { egressLevel: 1, data: 'internal' },
      ],
      publicInputs: { maxEgress: 1 },
      now: NOW,
    });
    expect(result.satisfied).toBe(true);
    expect(result.circuit).toBe('no-classified-egress');
    expect(result.commitmentRoot.length).toBe(64); // SHA-256 hex
    // Il log interno non è esposto: solo commitment root + risultato booleano.
    expect(JSON.stringify(result)).not.toContain('public');
    expect(JSON.stringify(result)).not.toContain('internal');
  });

  it('circuito no-classified-egress: NOT satisfied quando egressLevel > maxEgress', () => {
    const svc = new SovereignService();
    const result = svc.runZkpCompliance({
      enclaveId: 'enclave-zkp-leak',
      circuitName: 'no-classified-egress',
      internalLog: [{ egressLevel: 5, data: 'classified-secret' }],
      publicInputs: { maxEgress: 1 },
      now: NOW,
    });
    expect(result.satisfied).toBe(false);
    // Anche se NON satisfied, il dato classificato non esce (solo commitment).
    expect(JSON.stringify(result)).not.toContain('classified-secret');
  });

  it('ZKP audit rapido: <1h target PRD §6.4 (qui ms; il circuito è deterministico)', () => {
    const svc = new SovereignService();
    const t0 = performance.now();
    // Log interno più grande per simulare un audit reale.
    const bigLog = Array.from({ length: 100 }, (_, i) => ({ egressLevel: i % 2, entry: i }));
    const result = svc.runZkpCompliance({
      enclaveId: 'enclave-audit',
      circuitName: 'no-classified-egress',
      internalLog: bigLog,
      publicInputs: { maxEgress: 1 },
      now: NOW,
    });
    const elapsed = performance.now() - t0;
    expect(result.satisfied).toBe(true);
    // Gate PRD §6.4: ZKP compliance audit completato in <1h. Su simulatore: ms.
    expect(elapsed).toBeLessThan(3_600_000);
    expect(elapsed).toBeLessThan(1_000); // sanity: simulatore veloce
  });

  it('circuito non registrato → errore esplicito (mai silente)', () => {
    const svc = new SovereignService();
    expect(() =>
      svc.runZkpCompliance({
        enclaveId: 'e',
        circuitName: 'circuito-inesistente',
        internalLog: [],
        publicInputs: {},
        now: NOW,
      }),
    ).toThrow(/no ZKP circuit registered/);
  });

  it('circuito custom registrato via options viene eseguito', () => {
    const customCircuit = {
      name: 'custom-sox',
      property: 'tutti gli accessi sono autorizzati',
      execute: (log: Array<Record<string, unknown>>) =>
        log.every((e) => e.authorized === true),
    };
    const svc = new SovereignService({ zkpCircuits: [customCircuit] });
    const ok = svc.runZkpCompliance({
      enclaveId: 'e-sox',
      circuitName: 'custom-sox',
      internalLog: [{ authorized: true }, { authorized: true }],
      publicInputs: {},
      now: NOW,
    });
    expect(ok.satisfied).toBe(true);
    const fail = svc.runZkpCompliance({
      enclaveId: 'e-sox',
      circuitName: 'custom-sox',
      internalLog: [{ authorized: true }, { authorized: false }],
      publicInputs: {},
      now: NOW,
    });
    expect(fail.satisfied).toBe(false);
  });
});

describe('B3 — Dual-stack PQC hybrid certificates (interoperabilità transizione)', () => {
  it('emette certificato ibrido con firma PQC reale + fingerprint classico', () => {
    const svc = new SovereignService();
    svc.provisionTenantKey('tenant-hybrid', NOW);
    const cert = svc.issueHybridCertificate('tenant-hybrid', 'dual-stack', NOW);
    expect(cert.subjectId).toBe('tenant-hybrid');
    expect(cert.mode).toBe('dual-stack');
    expect(cert.pqcSignature.length).toBeGreaterThan(0); // firma ML-DSA reale
    expect(cert.classicalKeyFingerprint.length).toBe(64); // SHA-256 hex
    expect(cert.pqcAlgorithm).toBe('ML-DSA-65');
  });

  it('verifica la parte PQC del certificato ibrido (sistemi post-quantum)', () => {
    const svc = new SovereignService();
    svc.provisionTenantKey('tenant-verify', NOW);
    const cert = svc.issueHybridCertificate('tenant-verify', 'dual-stack', NOW);
    expect(svc.verifyHybridCertificate(cert)).toBe(true);
  });

  it('certificato manomesso → verifica PQC fallisce (integrità)', () => {
    const svc = new SovereignService();
    svc.provisionTenantKey('tenant-tamper', NOW);
    const cert = svc.issueHybridCertificate('tenant-tamper', 'dual-stack', NOW);
    const tampered = { ...cert, pqcSignature: cert.pqcSignature.slice(0, -4) + '0000' };
    expect(svc.verifyHybridCertificate(tampered)).toBe(false);
  });

  it('modalità pqc-only emessa correttamente (post-transizione)', () => {
    const svc = new SovereignService();
    svc.provisionTenantKey('tenant-pqconly', NOW);
    const cert = svc.issueHybridCertificate('tenant-pqconly', 'pqc-only', NOW);
    expect(cert.mode).toBe('pqc-only');
    expect(svc.verifyHybridCertificate(cert)).toBe(true);
  });

  it('dual-stack mitiga rischio PRD §10: certificato valido sia per legacy (fingerprint) che PQC (firma)', () => {
    const svc = new SovereignService();
    svc.provisionTenantKey('tenant-migration', NOW);
    const cert = svc.issueHybridCertificate('tenant-migration', 'dual-stack', NOW);
    // Sistema legacy: usa il fingerprint classico (presente e non vuoto).
    expect(cert.classicalKeyFingerprint).toBeTruthy();
    // Sistema post-quantum: verifica la firma PQC.
    expect(svc.verifyHybridCertificate(cert)).toBe(true);
    // Entrambi i componenti coesistono → transizione senza rottura.
  });
});