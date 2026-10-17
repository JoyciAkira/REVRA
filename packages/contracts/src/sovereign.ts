/**
 * Sovereign enclave contracts (PRD §3.4, §7 ComplianceProof): chiavi tenant
 * post-quantum (ML-DSA / FIPS 204), attestation remota delle enclave con
 * freshness, compliance come statement firmato PQC verificabile.
 *
 * Onestà di scoped: lo ZK circuit vero (Circom/Halo2, PRD §9) sostituirà il
 * commitment-attestato; il contratto pubblico (regulation, statement,
 * publicInputs, verifier) resta invariato.
 */
import { z } from 'zod';

export const PQC_ALGORITHMS = ['ML-DSA-65', 'SLH-DSA-SHA2-128s'] as const;
export type PqcAlgorithm = (typeof PQC_ALGORITHMS)[number];

export const TEE_VENDORS = ['Intel-TDX', 'AMD-SEV-SNP', 'ARM-CCA', 'software-simulated'] as const;
export type TeeVendor = (typeof TEE_VENDORS)[number];

export const tenantKeyInfoSchema = z.object({
  tenantId: z.string().min(1),
  algorithm: z.enum(PQC_ALGORITHMS),
  /** Impronta SHA-256 della chiave pubblica (la privata resta nell'HSM/stores). */
  publicKeyFingerprint: z.string(),
  createdAt: z.string().datetime(),
});
export type TenantKeyInfo = z.infer<typeof tenantKeyInfoSchema>;

export const attestationSchema = z.object({
  enclaveId: z.string().min(1),
  teeVendor: z.enum(TEE_VENDORS),
  /** Quote firmata ML-DSA: {enclaveId, vendor, nonce, measurements}. */
  quote: z.string(),
  nonce: z.string(),
  algorithm: z.enum(PQC_ALGORITHMS),
  signerFingerprint: z.string(),
  outcome: z.enum(['VERIFIED', 'REJECTED']),
  reason: z.string().optional(),
  verifiedAt: z.string().datetime(),
});
export type Attestation = z.infer<typeof attestationSchema>;

export const complianceProofSchema = z.object({
  id: z.string(),
  regulation: z.string().min(1),
  /** Proprietà dimostrata, in linguaggio del regolamento. */
  statement: z.string().min(1),
  publicInputs: z.record(z.string(), z.unknown()),
  /** Root di commitment sul log interno (mai il log stesso). */
  commitmentRoot: z.string(),
  /** Firma ML-DSA del prover (enclave) su statement+root+publicInputs. */
  proverSignature: z.string(),
  proverEnclaveId: z.string(),
  verified: z.boolean(),
  verifiedAt: z.string().datetime(),
  proverVersion: z.string(),
});
export type ComplianceProof = z.infer<typeof complianceProofSchema>;
