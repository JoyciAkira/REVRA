/**
 * P4 — PqcSignatureService (PRD §3.4 / §9, Best-in-Class PQC completo).
 *
 * Completa lo stack NIST PQC oltre ML-KEM-768 (FIPS 203, KEM) già presente in
 * PqcKemService e ML-DSA-65 (FIPS 204, firma primaria) già in SovereignService:
 * aggiunge SLH-DSA-SHA2-256s (FIPS 205) come FALLBACK HASH-BASED conservativo.
 *
 * Perché due algoritmi di firma (gap PRD best-in-class T5.1):
 * - ML-DSA-65 (FIPS 204, Dilithium): firma primaria, veloce, chiavi/firme
 *   compatte (pk 1952B, sk 4032B, sig 3309B), sicurezza basata su reticoli
 *   (Module-LWE). NIST Level 3.
 * - SLH-DSA-SHA2-256s (FIPS 205, SPHINCS+): fallback conservativo hash-based.
 *   La sua sicurezza poggia SOLO sulla resistenza della funzione hash SHA-2,
 *   senza assunzioni su reticoli/codici. È lo schema "belt-and-suspenders" che
 *   NIST raccomanda come diversificazione: se un attacco futuro rompesse i
 *   reticoli (ML-DSA), SLH-DSA resta sicuro. Firma più lenta e più grande
 *   (~49KB sig) ma sicurezza minimale e ben compresa.
 *
 * Strategia duale (ibrida classical+PQC non richiesta qui; qui è PQC+PQC):
 * - sign(data): produce DUE firme (ML-DSA primaria + SLH-DSA fallback).
 * - verify(data, bundle): accetta se ALMENO UNA delle due firme verifica.
 *   Questo garantisce disponibilità anche se uno schema fosse compromesso o
 *   deprecato: l'altro continua a validare. Coerente con "forward secrecy
 *   quantistica + difesa in profondità" del PRD §3.4.
 *
 * Resistenza side-channel: @noble/post-quantum implementa operazioni
 * constant-time sia per ML-DSA che per SLH-DSA (nessun branch data-dependent).
 * La resistenza completa richiede HSM hardware (PRD §9, T5.4 — gap separato).
 *
 * Gate P4/T5.1: stack PQC NIST completo (FIPS 203 KEM + 204 firma primaria +
 * 205 fallback hash-based), verificato end-to-end con round-trip sign/verify.
 */
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { slh_dsa_sha2_256s } from '@noble/post-quantum/slh-dsa.js';

export interface PqcKeyPair {
  /** Algoritmo ('ml-dsa-65' | 'slh-dsa-sha2-256s'). */
  readonly algorithm: 'ml-dsa-65' | 'slh-dsa-sha2-256s';
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

export interface DualSignatureBundle {
  /** Firma primaria ML-DSA-65 (FIPS 204). */
  readonly primary: { algorithm: 'ml-dsa-65'; signature: Uint8Array };
  /** Firma fallback SLH-DSA-SHA2-256s (FIPS 205, hash-based). */
  readonly fallback: { algorithm: 'slh-dsa-sha2-256s'; signature: Uint8Array };
  /** Dati firmati (per verifica indipendente). */
  readonly data: Uint8Array;
}

export interface DualVerificationResult {
  /** Vera se almeno una delle due firme verifica (difesa in profondità). */
  readonly valid: boolean;
  readonly primaryValid: boolean;
  readonly fallbackValid: boolean;
  /** Quale schema ha garantito la validità (per diagnostica/audit). */
  readonly satisfiedBy: Array<'ml-dsa-65' | 'slh-dsa-sha2-256s'>;
}

export class PqcSignatureService {
  /** Genera una coppia di chiavi ML-DSA-65 (FIPS 204, primaria). */
  generateMlDsaKeyPair(): PqcKeyPair {
    const { publicKey, secretKey } = ml_dsa65.keygen();
    return { algorithm: 'ml-dsa-65', publicKey, secretKey };
  }

  /** Genera una coppia di chiavi SLH-DSA-SHA2-256s (FIPS 205, fallback). */
  generateSlhDsaKeyPair(): PqcKeyPair {
    const { publicKey, secretKey } = slh_dsa_sha2_256s.keygen();
    return { algorithm: 'slh-dsa-sha2-256s', publicKey, secretKey };
  }

  /**
   * Firma i dati con entrambi gli schemi (primaria ML-DSA + fallback SLH-DSA).
   * Produce un bundle duale verificabile con verifyDual().
   */
  signDual(
    data: Uint8Array,
    mlDsaSecret: Uint8Array,
    slhDsaSecret: Uint8Array,
  ): DualSignatureBundle {
    const primarySig = ml_dsa65.sign(data, mlDsaSecret);
    const fallbackSig = slh_dsa_sha2_256s.sign(data, slhDsaSecret);
    return {
      primary: { algorithm: 'ml-dsa-65', signature: primarySig },
      fallback: { algorithm: 'slh-dsa-sha2-256s', signature: fallbackSig },
      data,
    };
  }

  /**
   * Verifica un bundle duale. Accetta se ALMENO UNA firma verifica.
   * Ritorna quali schemi hanno soddisfatto la verifica (per audit trail).
   */
  verifyDual(
    bundle: DualSignatureBundle,
    mlDsaPublic: Uint8Array,
    slhDsaPublic: Uint8Array,
  ): DualVerificationResult {
    const primaryValid = ml_dsa65.verify(bundle.primary.signature, bundle.data, mlDsaPublic);
    const fallbackValid = slh_dsa_sha2_256s.verify(
      bundle.fallback.signature,
      bundle.data,
      slhDsaPublic,
    );
    const satisfiedBy: Array<'ml-dsa-65' | 'slh-dsa-sha2-256s'> = [];
    if (primaryValid) satisfiedBy.push('ml-dsa-65');
    if (fallbackValid) satisfiedBy.push('slh-dsa-sha2-256s');
    return {
      valid: primaryValid || fallbackValid,
      primaryValid,
      fallbackValid,
      satisfiedBy,
    };
  }

  /**
   * Verifica solo la firma primaria ML-DSA-65 (per compatibilità con sistemi
   * che non supportano ancora il bundle duale / FIPS 205).
   */
  verifyPrimary(
    signature: Uint8Array,
    data: Uint8Array,
    mlDsaPublic: Uint8Array,
  ): boolean {
    return ml_dsa65.verify(signature, data, mlDsaPublic);
  }

  /**
   * Verifica solo la firma fallback SLH-DSA-SHA2-256s (per audit conservativo
   * o quando la primaria è deprecata/compromessa).
   */
  verifyFallback(
    signature: Uint8Array,
    data: Uint8Array,
    slhDsaPublic: Uint8Array,
  ): boolean {
    return slh_dsa_sha2_256s.verify(signature, data, slhDsaPublic);
  }

  /** Summary degli algoritmi supportati (per report compliance / audit). */
  algorithmSummary(): {
    primary: { algorithm: string; fips: string; securityLevel: string; note: string };
    fallback: { algorithm: string; fips: string; securityLevel: string; note: string };
    kem: { algorithm: string; fips: string; securityLevel: string; note: string };
  } {
    return {
      primary: {
        algorithm: 'ML-DSA-65',
        fips: 'FIPS 204 (Aug 2024)',
        securityLevel: 'NIST Level 3',
        note: 'Firma primaria basata su reticoli (Module-LWE). Veloce, firme compatte.',
      },
      fallback: {
        algorithm: 'SLH-DSA-SHA2-256s',
        fips: 'FIPS 205 (Aug 2024)',
        securityLevel: 'NIST Level 5',
        note: 'Fallback hash-based conservativo. Sicurezza poggia solo su SHA-2. Firme ~49KB, più lente, ma minima assunzione crittografica.',
      },
      kem: {
        algorithm: 'ML-KEM-768',
        fips: 'FIPS 203 (Aug 2024)',
        securityLevel: 'NIST Level 3',
        note: 'Key encapsulation per forward secrecy quantistica (PqcKemService).',
      },
    };
  }
}