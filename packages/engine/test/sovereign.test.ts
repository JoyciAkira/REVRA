/**
 * Sovereign seam (PRD §3.4): chiavi tenant ML-DSA-65 reali, attestation con
 * freshness (replay → REJECTED), compliance come statement firmato PQC con
 * commitment root del log interno (mai il log stesso).
 */
import { describe, expect, it } from 'vitest';
import { SovereignService } from '../src/sovereign/sovereign-service.js';

describe('tenant PQC keys (ML-DSA-65)', () => {
  it('signs and verifies tenant data with a post-quantum signature', () => {
    const svc = new SovereignService();
    const info = svc.provisionTenantKey('tenant-1', '2026-10-11T00:00:00.000Z');

    expect(info.algorithm).toBe('ML-DSA-65');
    expect(info.publicKeyFingerprint).toHaveLength(64);

    const { signature } = svc.signForTenant('tenant-1', 'artifact:abc');
    expect(svc.verifyTenantSignature('tenant-1', 'artifact:abc', signature)).toBe(true);
    expect(svc.verifyTenantSignature('tenant-1', 'artifact:TAMPERED', signature)).toBe(false);
  });

  it('rejects unknown tenants and duplicate provisioning', () => {
    const svc = new SovereignService();
    expect(() => svc.signForTenant('ghost', 'x')).toThrowError(/RESULT_NOT_FOUND/);
    svc.provisionTenantKey('tenant-1', '2026-10-11T00:00:00.000Z');
    expect(() => svc.provisionTenantKey('tenant-1', '2026-10-11T00:00:01.000Z')).toThrowError(
      /INVALID_TRANSITION/,
    );
  });
});

describe('remote attestation', () => {
  it('verifies a fresh quote and rejects nonce replay', () => {
    const svc = new SovereignService();
    const nonce = svc.randomNonce();

    const first = svc.attest({
      enclaveId: 'enclave-eu-1',
      teeVendor: 'AMD-SEV-SNP',
      nonce,
      now: '2026-10-11T00:00:00.000Z',
    });
    expect(first.outcome).toBe('VERIFIED');

    const replay = svc.attest({
      enclaveId: 'enclave-eu-1',
      teeVendor: 'AMD-SEV-SNP',
      nonce,
      now: '2026-10-11T00:00:01.000Z',
    });
    expect(replay.outcome).toBe('REJECTED');
    expect(replay.reason).toMatch(/replay/);
  });

  it('rejects vendors outside the allowlist', () => {
    const svc = new SovereignService({
      allowedVendors: ['Intel-TDX', 'AMD-SEV-SNP', 'ARM-CCA', 'software-simulated'],
    });
    const outcome = svc.attest({
      enclaveId: 'enclave-x',
      teeVendor: 'software-simulated',
      nonce: svc.randomNonce(),
      now: '2026-10-11T00:00:00.000Z',
    });
    // software-simulated è in allowlist (sviluppo); vendor inventato no.
    const custom = new SovereignService({ allowedVendors: ['Intel-TDX'] });
    const denied = custom.attest({
      enclaveId: 'enclave-y',
      teeVendor: 'software-simulated',
      nonce: custom.randomNonce(),
      now: '2026-10-11T00:00:00.000Z',
    });
    expect(outcome.outcome).toBe('VERIFIED');
    expect(denied.outcome).toBe('REJECTED');
  });
});

describe('compliance proofs', () => {
  it('produces a signed, verifiable statement without exposing the internal log', () => {
    const svc = new SovereignService();
    svc.provisionTenantKey('enclave:enclave-eu-1', '2026-10-11T00:00:00.000Z');

    const proof = svc.proveCompliance({
      enclaveId: 'enclave-eu-1',
      regulation: 'GDPR',
      statement: 'nessun dato classificato ha lasciato l\'enclave',
      internalLog: [
        { event: 'read', level: 'confidential' },
        { event: 'compute', level: 'secret' },
        { event: 'egress', level: 'none' },
      ],
      publicInputs: { maxEgressLevel: 'none', windowHours: 24 },
      now: '2026-10-11T00:00:00.000Z',
    });

    expect(proof.verified).toBe(true);
    expect(proof.commitmentRoot).toHaveLength(64);
    expect(JSON.stringify(proof)).not.toContain('confidential');
    expect(svc.verifyCompliance(proof)).toBe(true);

    // Manipolazione del public input → firma non valida → compliance rotta.
    const tampered = { ...proof, publicInputs: { maxEgressLevel: 'secret', windowHours: 24 } };
    expect(svc.verifyCompliance(tampered)).toBe(false);
  });

  it('refuses compliance proofs from unprovisioned enclaves', () => {
    const svc = new SovereignService();
    expect(() =>
      svc.proveCompliance({
        enclaveId: 'ghost',
        regulation: 'GDPR',
        statement: 'x',
        internalLog: [],
        publicInputs: {},
        now: '2026-10-11T00:00:00.000Z',
      }),
    ).toThrowError(/RESULT_NOT_FOUND/);
  });
});
