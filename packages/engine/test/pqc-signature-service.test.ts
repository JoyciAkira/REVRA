/**
 * P4/T5.1 — PqcSignatureService (stack PQC NIST completo: FIPS 203 KEM +
 * 204 firma primaria ML-DSA + 205 fallback hash-based SLH-DSA).
 *
 * Gate: stack PQC completo verificato end-to-end con round-trip sign/verify
 * duale (primaria + fallback), difesa in profondità (valido se almeno una
 * firma verifica), e summary algoritmi conforme FIPS 203/204/205.
 */
import { describe, expect, it } from 'vitest';
import { PqcSignatureService } from '../src/sovereign/pqc-signature-service.js';
import { PqcKemService } from '../src/sovereign/pqc-kem-service.js';

describe('P4/T5.1 — PqcSignatureService (FIPS 204 primaria + FIPS 205 fallback)', () => {
  it('genera coppie di chiavi ML-DSA-65 e SLH-DSA-SHA2-256s distinte e non vuote', { timeout: 60_000 }, () => {
    const svc = new PqcSignatureService();
    const mlDsa = svc.generateMlDsaKeyPair();
    const slhDsa = svc.generateSlhDsaKeyPair();
    expect(mlDsa.algorithm).toBe('ml-dsa-65');
    expect(slhDsa.algorithm).toBe('slh-dsa-sha2-256s');
    expect(mlDsa.publicKey.length).toBeGreaterThan(0);
    expect(mlDsa.secretKey.length).toBeGreaterThan(0);
    expect(slhDsa.publicKey.length).toBeGreaterThan(0);
    expect(slhDsa.secretKey.length).toBeGreaterThan(0);
    expect(Buffer.from(mlDsa.publicKey).equals(Buffer.from(slhDsa.publicKey))).toBe(false);
  });

  it('ROUND-TRIP DUALE: signDual + verifyDual accetta se entrambe le firme verificano', { timeout: 60_000 }, () => {
    const svc = new PqcSignatureService();
    const mlDsa = svc.generateMlDsaKeyPair();
    const slhDsa = svc.generateSlhDsaKeyPair();
    const data = new TextEncoder().encode('REVRA sovereign compliance statement v3.0');
    const bundle = svc.signDual(data, mlDsa.secretKey, slhDsa.secretKey);
    const result = svc.verifyDual(bundle, mlDsa.publicKey, slhDsa.publicKey);
    expect(result.valid).toBe(true);
    expect(result.primaryValid).toBe(true);
    expect(result.fallbackValid).toBe(true);
    expect(result.satisfiedBy).toContain('ml-dsa-65');
    expect(result.satisfiedBy).toContain('slh-dsa-sha2-256s');
  });

  it("DIFESA IN PROFONDITA: verifyDual resta valido se la primaria e' corrotta (fallback salva)", () => {
    const svc = new PqcSignatureService();
    const mlDsa = svc.generateMlDsaKeyPair();
    const slhDsa = svc.generateSlhDsaKeyPair();
    const data = new TextEncoder().encode('classified binary analysis attestation');
    const bundle = svc.signDual(data, mlDsa.secretKey, slhDsa.secretKey);
    const corruptedPrimary = new Uint8Array(bundle.primary.signature);
    corruptedPrimary[0] ^= 0xff;
    const tamperedBundle = { ...bundle, primary: { ...bundle.primary, signature: corruptedPrimary } };
    const result = svc.verifyDual(tamperedBundle, mlDsa.publicKey, slhDsa.publicKey);
    expect(result.valid).toBe(true);
    expect(result.primaryValid).toBe(false);
    expect(result.fallbackValid).toBe(true);
    expect(result.satisfiedBy).toEqual(['slh-dsa-sha2-256s']);
  });

  it("DIFESA IN PROFONDITA: verifyDual resta valido se il fallback e' corrotto (primaria salva)", () => {
    const svc = new PqcSignatureService();
    const mlDsa = svc.generateMlDsaKeyPair();
    const slhDsa = svc.generateSlhDsaKeyPair();
    const data = new TextEncoder().encode('tenant key material endorsement');
    const bundle = svc.signDual(data, mlDsa.secretKey, slhDsa.secretKey);
    const corruptedFallback = new Uint8Array(bundle.fallback.signature);
    corruptedFallback[0] ^= 0xff;
    const tamperedBundle = { ...bundle, fallback: { ...bundle.fallback, signature: corruptedFallback } };
    const result = svc.verifyDual(tamperedBundle, mlDsa.publicKey, slhDsa.publicKey);
    expect(result.valid).toBe(true);
    expect(result.primaryValid).toBe(true);
    expect(result.fallbackValid).toBe(false);
    expect(result.satisfiedBy).toEqual(['ml-dsa-65']);
  });

  it('REJECT: verifyDual fallisce se ENTRAMBE le firme sono corrotte', { timeout: 60_000 }, () => {
    const svc = new PqcSignatureService();
    const mlDsa = svc.generateMlDsaKeyPair();
    const slhDsa = svc.generateSlhDsaKeyPair();
    const data = new TextEncoder().encode('dual-signed artifact');
    const bundle = svc.signDual(data, mlDsa.secretKey, slhDsa.secretKey);
    const corruptedPrimary = new Uint8Array(bundle.primary.signature);
    corruptedPrimary[0] ^= 0xff;
    const corruptedFallback = new Uint8Array(bundle.fallback.signature);
    corruptedFallback[0] ^= 0xff;
    const tamperedBundle = {
      ...bundle,
      primary: { ...bundle.primary, signature: corruptedPrimary },
      fallback: { ...bundle.fallback, signature: corruptedFallback },
    };
    const result = svc.verifyDual(tamperedBundle, mlDsa.publicKey, slhDsa.publicKey);
    expect(result.valid).toBe(false);
    expect(result.primaryValid).toBe(false);
    expect(result.fallbackValid).toBe(false);
    expect(result.satisfiedBy).toEqual([]);
  });

  it('REJECT: verifyPrimary/verifyFallback falliscono su dati alterati', { timeout: 60_000 }, () => {
    const svc = new PqcSignatureService();
    const mlDsa = svc.generateMlDsaKeyPair();
    const slhDsa = svc.generateSlhDsaKeyPair();
    const data = new TextEncoder().encode('original statement');
    const altered = new TextEncoder().encode('tampered statement');
    const bundle = svc.signDual(data, mlDsa.secretKey, slhDsa.secretKey);
    expect(svc.verifyPrimary(bundle.primary.signature, altered, mlDsa.publicKey)).toBe(false);
    expect(svc.verifyFallback(bundle.fallback.signature, altered, slhDsa.publicKey)).toBe(false);
  });

  it('REJECT: verifica con chiave pubblica sbagliata fallisce', { timeout: 60_000 }, () => {
    const svc = new PqcSignatureService();
    const mlDsaA = svc.generateMlDsaKeyPair();
    const mlDsaB = svc.generateMlDsaKeyPair();
    const slhDsaA = svc.generateSlhDsaKeyPair();
    const slhDsaB = svc.generateSlhDsaKeyPair();
    const data = new TextEncoder().encode('cross-key rejection test');
    const bundle = svc.signDual(data, mlDsaA.secretKey, slhDsaA.secretKey);
    const result = svc.verifyDual(bundle, mlDsaB.publicKey, slhDsaB.publicKey);
    expect(result.valid).toBe(false);
  });

  it('ALGORITHM SUMMARY: riporta FIPS 203/204/205 con security level NIST corretti', { timeout: 60_000 }, () => {
    const svc = new PqcSignatureService();
    const summary = svc.algorithmSummary();
    expect(summary.primary.algorithm).toBe('ML-DSA-65');
    expect(summary.primary.fips).toContain('FIPS 204');
    expect(summary.primary.securityLevel).toBe('NIST Level 3');
    expect(summary.fallback.algorithm).toBe('SLH-DSA-SHA2-256s');
    expect(summary.fallback.fips).toContain('FIPS 205');
    expect(summary.fallback.note.toLowerCase()).toContain('hash');
    expect(summary.kem.algorithm).toBe('ML-KEM-768');
    expect(summary.kem.fips).toContain('FIPS 203');
  });

  it('GATE STACK PQC COMPLETO: KEM (FIPS 203) + firma primaria (204) + fallback (205) tutti operativi', { timeout: 60_000 }, () => {
    const svc = new PqcSignatureService();
    // Firma duale operativa (204 + 205).
    const mlDsa = svc.generateMlDsaKeyPair();
    const slhDsa = svc.generateSlhDsaKeyPair();
    const data = new TextEncoder().encode('full PQC stack gate v3.0');
    const bundle = svc.signDual(data, mlDsa.secretKey, slhDsa.secretKey);
    const verified = svc.verifyDual(bundle, mlDsa.publicKey, slhDsa.publicKey);
    expect(verified.valid).toBe(true);
    // KEM operativo (FIPS 203) — nome reale del metodo: generateEphemeralKeyPair.
    const kem = new PqcKemService();
    const alice = kem.generateEphemeralKeyPair();
    const enc = kem.encapsulate(alice.publicKey);
    const dec = kem.decapsulate(enc.cipherText, alice.secretKey);
    expect(dec.sharedSecret).toBeDefined();
    // Stack completo: 3 standard NIST PQC (203/204/205) tutti verdi.
    const s = svc.algorithmSummary();
    expect(s.primary.fips.includes('204') && s.fallback.fips.includes('205') && s.kem.fips.includes('203')).toBe(true);
  });
});