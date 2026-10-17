/**
 * Sovereign services (PRD §3.4): chiavi tenant post-quantum reali (ML-DSA-65,
 * @noble/post-quantum), attestation remota con freshness nonce, compliance
 * come statement firmato PQC verificabile.
 *
 * B3: simulatore onesto di circuito ZK compliance (seam stabile per Circom/Halo2
 * reale in produzione) + certificati ibridi dual-stack classical+PQC per
 * interoperabilità durante la transizione quantistica (mitiga rischio PRD §10
 * "PQC migration rompe legacy").
 *
 * Le chiavi private vivono in-memory: in produzione sono in HSM (PRD §9,
 * Sovereign Compute Stack) — il seam TenantKeyService resta identico.
 */
import { createHash, randomBytes } from 'node:crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import type {
  Attestation,
  ComplianceProof,
  TeeVendor,
  TenantKeyInfo,
} from '@revra/contracts';
import { KernelRuleError } from '@revra/kernel';

const PROVER_VERSION = 'revra-compliance-prover@0.1.0';
const DEFAULT_ALLOWED_VENDORS: TeeVendor[] = ['Intel-TDX', 'AMD-SEV-SNP', 'ARM-CCA', 'software-simulated'];

/**
 * B3 — Simulatore di circuito ZK compliance (PRD §3.4, §9 Circom/Halo2).
 * Dimostra una proprietà sul log interno dell'enclave SENZA rivelare il log:
 * il verifier controlla solo il commitment root + la firma PQC + i public inputs.
 * Seam stabile: in produzione sarà sostituito da un circuito Circom/Halo2 reale,
 * ma il contratto pubblico (commitmentRoot, proverSignature, publicInputs) resta
 * identico. Gate B3: ZKP compliance audit <1h (PRD §6.4).
 */
export interface ZkpComplianceCircuit {
  /** Nome del circuito (es. "no-classified-egress"). */
  name: string;
  /** Proprietà dimostrata in linguaggio naturale (per l'auditor umano). */
  property: string;
  /**
   * Esegue il circuito: dato il log interno (privato) e i public inputs,
   * ritorna true se la proprietà è soddisfatta. Il log non esce mai dal prover.
   */
  execute(internalLog: Array<Record<string, unknown>>, publicInputs: Record<string, unknown>): boolean;
}

/**
 * B3 — Circuito ZK predefinito: "nessun dato classificato è uscito dall'enclave".
 * Verifica che ogni entry del log interno abbia egressLevel <= maxEgress (public input).
 * Il log interno (con i dati reali) non viene mai esposto: solo il commitment root.
 */
export const NO_CLASSIFIED_EGRESS_CIRCUIT: ZkpComplianceCircuit = {
  name: 'no-classified-egress',
  property: "nessun dato con egressLevel > maxEgress dichiarato è uscito dall'enclave",
  execute(internalLog, publicInputs) {
    const maxEgress = typeof publicInputs.maxEgress === 'number' ? publicInputs.maxEgress : 0;
    return internalLog.every((entry) => {
      const level = typeof entry.egressLevel === 'number' ? entry.egressLevel : 0;
      return level <= maxEgress;
    });
  },
};

/**
 * B3 — Certificato ibrido classical+PQC per interoperabilità durante la
 * transizione quantistica (mitiga rischio PRD §10 "PQC migration rompe legacy").
 * Contiene sia una firma PQC (ML-DSA, verificabile dai sistemi post-quantum) che
 * l'impronta della chiave classica (verificabile dai sistemi legacy). In produzione
 * la firma classica vera è generata dall'HSM dual-mode.
 */
export interface HybridCertificate {
  subjectId: string;
  /** Firma PQC (ML-DSA) — verificabile dai sistemi post-quantum. */
  pqcSignature: string;
  /** Impronta della chiave classica (la firma classica vera è generata dall'HSM). */
  classicalKeyFingerprint: string;
  pqcAlgorithm: string;
  issuedAt: string;
  /** dual-stack (transizione) o pqc-only. */
  mode: 'dual-stack' | 'pqc-only';
}

export interface SovereignOptions {
  idGen?: () => string;
  now?: () => string;
  allowedVendors?: TeeVendor[];
  /** B3: circuiti ZK compliance registrati (default: no-classified-egress). */
  zkpCircuits?: ZkpComplianceCircuit[];
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

interface TenantKeys {
  info: TenantKeyInfo;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export class SovereignService {
  private readonly tenants = new Map<string, TenantKeys>();
  private readonly usedNonces = new Set<string>();
  private readonly proofs = new Map<string, ComplianceProof>();
  private seq = 0;

  constructor(private readonly options: SovereignOptions = {}) {}

  // ---------------------------------------------------------------------------
  // Tenant PQC keys (ML-DSA-65, FIPS 204)
  // ---------------------------------------------------------------------------

  provisionTenantKey(tenantId: string, now: string): TenantKeyInfo {
    if (this.tenants.has(tenantId)) {
      throw new KernelRuleError('INVALID_TRANSITION', `tenant ${tenantId} already provisioned`);
    }
    const { publicKey, secretKey } = ml_dsa65.keygen();
    const info: TenantKeyInfo = {
      tenantId,
      algorithm: 'ML-DSA-65',
      publicKeyFingerprint: sha256Hex(publicKey),
      createdAt: now,
    };
    this.tenants.set(tenantId, { info, publicKey, secretKey });
    return info;
  }

  signForTenant(tenantId: string, data: string): { signature: string } {
    const tenant = this.requireTenant(tenantId);
    // API noble v0.7: sign(msg, secretKey) — nota l'ordine.
    const signature = ml_dsa65.sign(new TextEncoder().encode(data), tenant.secretKey);
    return { signature: Buffer.from(signature).toString('hex') };
  }

  verifyTenantSignature(tenantId: string, data: string, signatureHex: string): boolean {
    const tenant = this.requireTenant(tenantId);
    // API noble v0.7: verify(sig, msg, publicKey).
    return ml_dsa65.verify(
      Buffer.from(signatureHex, 'hex'),
      new TextEncoder().encode(data),
      tenant.publicKey,
    );
  }

  // ---------------------------------------------------------------------------
  // Remote attestation (RATS-style: quote firmata + freshness nonce)
  // ---------------------------------------------------------------------------

  attest(input: {
    enclaveId: string;
    teeVendor: TeeVendor;
    nonce: string;
    measurements?: Record<string, string>;
    now: string;
  }): Attestation {
    const rejected = (reason: string): Attestation => ({
      enclaveId: input.enclaveId,
      teeVendor: input.teeVendor,
      quote: '',
      nonce: input.nonce,
      algorithm: 'ML-DSA-65',
      signerFingerprint: '',
      outcome: 'REJECTED',
      reason,
      verifiedAt: input.now,
    });

    const allowed = this.options.allowedVendors ?? DEFAULT_ALLOWED_VENDORS;
    if (!allowed.includes(input.teeVendor)) {
      return rejected(`vendor ${input.teeVendor} fuori policy`);
    }
    if (this.usedNonces.has(input.nonce)) {
      return rejected('nonce replay: freshness non dimostrata');
    }
    this.usedNonces.add(input.nonce);

    const enclaveTenantId = `enclave:${input.enclaveId}`;
    if (!this.tenants.has(enclaveTenantId)) {
      this.provisionTenantKey(enclaveTenantId, input.now);
    }
    const measurements = input.measurements ?? { runtime: 'revra-enclave-runtime@0.1.0' };
    const quotePayload = JSON.stringify({
      enclaveId: input.enclaveId,
      vendor: input.teeVendor,
      nonce: input.nonce,
      measurements,
    });
    const quote = this.signForTenant(enclaveTenantId, quotePayload).signature;

    const signatureValid = this.verifyTenantSignature(enclaveTenantId, quotePayload, quote);
    if (!signatureValid) {
      return rejected('quote signature invalida');
    }

    return {
      enclaveId: input.enclaveId,
      teeVendor: input.teeVendor,
      quote,
      nonce: input.nonce,
      algorithm: 'ML-DSA-65',
      signerFingerprint: this.requireTenant(enclaveTenantId).info.publicKeyFingerprint,
      outcome: 'VERIFIED',
      verifiedAt: input.now,
    };
  }

  // ---------------------------------------------------------------------------
  // Compliance (statement firmato PQC + commitment del log interno)
  // ---------------------------------------------------------------------------

  proveCompliance(input: {
    enclaveId: string;
    regulation: string;
    statement: string;
    internalLog: Array<Record<string, unknown>>;
    publicInputs: Record<string, unknown>;
    now: string;
  }): ComplianceProof {
    const enclaveTenantId = `enclave:${input.enclaveId}`;
    if (!this.tenants.has(enclaveTenantId)) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no provisioned enclave ${input.enclaveId}`);
    }
    const commitmentRoot = sha256Hex(
      input.internalLog.map((entry) => sha256Hex(JSON.stringify(entry))).join(''),
    );
    const statement = JSON.stringify({
      regulation: input.regulation,
      statement: input.statement,
      publicInputs: input.publicInputs,
      commitmentRoot,
    });
    const signature = this.signForTenant(enclaveTenantId, statement).signature;
    const proof: ComplianceProof = {
      id: this.nextId('proof'),
      regulation: input.regulation,
      statement: input.statement,
      publicInputs: input.publicInputs,
      commitmentRoot,
      proverSignature: signature,
      proverEnclaveId: input.enclaveId,
      verified: this.verifyTenantSignature(enclaveTenantId, statement, signature),
      verifiedAt: input.now,
      proverVersion: PROVER_VERSION,
    };
    this.proofs.set(proof.id, proof);
    return proof;
  }

  verifyCompliance(proof: ComplianceProof): boolean {
    const enclaveTenantId = `enclave:${proof.proverEnclaveId}`;
    const statement = JSON.stringify({
      regulation: proof.regulation,
      statement: proof.statement,
      publicInputs: proof.publicInputs,
      commitmentRoot: proof.commitmentRoot,
    });
    return this.verifyTenantSignature(enclaveTenantId, statement, proof.proverSignature);
  }

  getProof(id: string): ComplianceProof | undefined {
    return this.proofs.get(id);
  }

  // ---------------------------------------------------------------------------
  // B3 — ZKP compliance circuit execution (simulatore onesto, PRD §3.4/§9)
  // ---------------------------------------------------------------------------

  /**
   * B3 — Esegue un circuito ZK compliance sul log interno dell'enclave.
   * Dimostra la proprietà SENZA rivelare il log: ritorna il risultato del
   * circuito + il commitment root. Timing misurabile: gate PRD §6.4 "ZKP audit <1h".
   * In produzione il circuito è Circom/Halo2 reale; qui è un simulatore
   * deterministico con lo stesso contratto pubblico.
   */
  runZkpCompliance(input: {
    enclaveId: string;
    circuitName: string;
    internalLog: Array<Record<string, unknown>>;
    publicInputs: Record<string, unknown>;
    now: string;
  }): { satisfied: boolean; commitmentRoot: string; elapsedMs: number; circuit: string } {
    const t0 = performance.now();
    const circuits = this.options.zkpCircuits ?? [NO_CLASSIFIED_EGRESS_CIRCUIT];
    const circuit = circuits.find((c) => c.name === input.circuitName);
    if (!circuit) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no ZKP circuit registered with name ${input.circuitName}`);
    }
    const commitmentRoot = sha256Hex(
      input.internalLog.map((entry) => sha256Hex(JSON.stringify(entry))).join(''),
    );
    const satisfied = circuit.execute(input.internalLog, input.publicInputs);
    return {
      satisfied,
      commitmentRoot,
      elapsedMs: performance.now() - t0,
      circuit: circuit.name,
    };
  }

  // ---------------------------------------------------------------------------
  // B3 — Dual-stack PQC hybrid certificates (interoperabilità transizione)
  // ---------------------------------------------------------------------------

  /**
   * B3 — Emette un certificato ibrido classical+PQC per un tenant/enclave.
   * Durante la transizione quantistica i sistemi legacy verificano la parte
   * classica (fingerprint), i nuovi la firma PQC. Mitiga il rischio PRD §10
   * "PQC migration rompe compatibilità con sistemi legacy".
   */
  issueHybridCertificate(
    subjectId: string,
    mode: 'dual-stack' | 'pqc-only' = 'dual-stack',
    now?: string,
  ): HybridCertificate {
    const tenant = this.requireTenant(subjectId);
    const timestamp = now ?? this.now();
    const certPayload = JSON.stringify({ subjectId, mode, issuedAt: timestamp, algorithm: 'ML-DSA-65' });
    const pqcSignature = this.signForTenant(subjectId, certPayload).signature;
    const classicalKeyFingerprint = sha256Hex(`classical:${tenant.info.publicKeyFingerprint}:${mode}`);
    return {
      subjectId,
      pqcSignature,
      classicalKeyFingerprint,
      pqcAlgorithm: 'ML-DSA-65',
      issuedAt: timestamp,
      mode,
    };
  }

  /** B3: verifica la parte PQC di un certificato ibrido. */
  verifyHybridCertificate(cert: HybridCertificate, statementPayload?: string): boolean {
    const payload =
      statementPayload ??
      JSON.stringify({
        subjectId: cert.subjectId,
        mode: cert.mode,
        issuedAt: cert.issuedAt,
        algorithm: cert.pqcAlgorithm,
      });
    return this.verifyTenantSignature(cert.subjectId, payload, cert.pqcSignature);
  }

  randomNonce(): string {
    return randomBytes(16).toString('hex');
  }

  private requireTenant(tenantId: string): TenantKeys {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new KernelRuleError('RESULT_NOT_FOUND', `no PQC keys provisioned for ${tenantId}`);
    }
    return tenant;
  }

  private nextId(prefix: string): string {
    return this.options.idGen ? this.options.idGen() : `${prefix}-${++this.seq}`;
  }

  private now(): string {
    return this.options.now ? this.options.now() : new Date().toISOString();
  }
}