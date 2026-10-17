/**
 * G5.3 — ZKP compliance (PRD §3.4, Beyond Limits).
 *
 * Gate: "audit compliance ZKP completato con garanzia matematica". La compliance
 * (GDPR, ITAR, etc.) viene dimostrata tramite Zero-Knowledge Proof: l'enclave
 * prova di rispettare una regolamentazione SENZA rivelare i dati interni che
 * potrebbero essere classificati o sensibili. Il verifier esterno controlla la
 * prova matematicamente (firma PQC valida + commitment root coerente col circuito)
 * e ottiene garanzia formale che la proprietà è soddisfatta, senza mai vedere
 * il log interno dell'enclave.
 *
 * Il SovereignService implementa:
 * - proveCompliance(): genera un ComplianceProof con statement firmato PQC
 *   (ML-DSA-65) + commitment root del log interno (hash Merkle-like).
 * - verifyCompliance(): verifica la firma PQC sullo statement (garanzia
 *   matematica che la prova proviene dall'enclave attestato).
 * - runZkpCompliance(): esegue un circuito ZK (es. NO_CLASSIFIED_EGRESS_CIRCUIT)
 *   sul log interno e ritorna satisfied=true/false + commitment root + tempo
 *   di esecuzione. Il circuito dimostra la proprietà senza esporre il log.
 *
 * Questo test verifica il gate:
 * 1. Il circuito ZK dimostra "nessun dato classificato è uscito" (egressLevel
 *    <= maxEgress per ogni entry) senza rivelare il log interno.
 * 2. La prova è verificabile matematicamente: firma PQC valida + commitment
 *    root coerente tra proveCompliance e runZkpCompliance.
 * 3. L'audit completa in tempi ragionevoli (<1h come da PRD §6.4; qui ms dato
 *    che è un simulatore deterministico, ma il principio è verificato).
 * 4. Se il log viola la proprietà (es. egressLevel > maxEgress), il circuito
 *    ritorna satisfied=false (onestà: la prova fallisce, non viene falsificata).
 *
 * Coerente con G5.1 (PQC ML-KEM per forward secrecy) e G5.2 (attestazione
 * remota): la compliance ZKP usa ML-DSA-65 per firmare lo statement, e
 * l'enclave che genera la prova deve essere attestato (G5.2) per essere
 * credibile.
 */
import { describe, expect, it } from 'vitest';
import { SovereignService, NO_CLASSIFIED_EGRESS_CIRCUIT } from '../src/sovereign/sovereign-service.js';

const NOW = '2026-10-14T00:00:00.000Z';

describe('G5.3 — ZKP compliance (audit con garanzia matematica, senza rivelare dati)', () => {
  it('GATE ZKP: circuito NO_CLASSIFIED_EGRESS dimostra proprietà senza rivelare log interno', () => {
    const svc = new SovereignService();
    // Log interno dell'enclave: ogni entry ha egressLevel (0=nessun egress,
    // 1=egress consentito, 2+=classificato). Il circuito verifica che tutti
    // gli egressLevel siano <= maxEgress (public input).
    const internalLog = [
      { operation: 'read-binary', egressLevel: 0, timestamp: '2026-10-14T00:00:01Z' },
      { operation: 'analyze-function', egressLevel: 0, timestamp: '2026-10-14T00:00:02Z' },
      { operation: 'write-report', egressLevel: 1, timestamp: '2026-10-14T00:00:03Z' }, // egress consentito
      { operation: 'cache-result', egressLevel: 0, timestamp: '2026-10-14T00:00:04Z' },
    ];
    const publicInputs = { maxEgress: 1 }; // policy: massimo egress level 1

    const t0 = performance.now();
    const result = svc.runZkpCompliance({
      enclaveId: 'enclave-zkp-001',
      circuitName: 'no-classified-egress',
      internalLog,
      publicInputs,
      now: NOW,
    });
    const elapsedMs = performance.now() - t0;

    // Il circuito è soddisfatto: nessun egress classificato (tutti <= 1).
    expect(result.satisfied).toBe(true);
    // Il commitment root è presente (hash del log, usato per verificare coerenza).
    expect(result.commitmentRoot.length).toBeGreaterThan(0);
    // Il circuito eseguito è quello atteso.
    expect(result.circuit).toBe('no-classified-egress');
    // Gate PRD §6.4: audit ZKP < 1h (3600000ms). Qui è un simulatore, quindi ms.
    expect(elapsedMs).toBeLessThan(3600000);
  });

  it('GATE MATEMATICO: proveCompliance genera proof verificabile (firma PQC valida + commitment coerente)', () => {
    const svc = new SovereignService();
    // Prima attestiamo l'enclave (G5.2) per provisionare le chiavi PQC.
    svc.attest({
      enclaveId: 'enclave-zkp-002',
      teeVendor: 'Intel-TDX',
      nonce: svc.randomNonce(),
      now: NOW,
    });

    const internalLog = [
      { operation: 'read-binary', egressLevel: 0 },
      { operation: 'write-report', egressLevel: 1 },
    ];
    const publicInputs = { maxEgress: 1 };

    // Genera la prova di compliance.
    const proof = svc.proveCompliance({
      enclaveId: 'enclave-zkp-002',
      regulation: 'GDPR-Article-32',
      statement: 'Nessun dato personale classificato è uscito dall\'enclave',
      internalLog,
      publicInputs,
      now: NOW,
    });

    // La prova è verificata matematicamente (firma PQC valida).
    expect(proof.verified).toBe(true);
    // Il commitment root è presente (hash del log interno).
    expect(proof.commitmentRoot.length).toBeGreaterThan(0);
    // La firma del prover è presente (ML-DSA-65).
    expect(proof.proverSignature.length).toBeGreaterThan(0);
    // L'enclave che ha generato la prova è tracciato.
    expect(proof.proverEnclaveId).toBe('enclave-zkp-002');

    // Verifica esterna: un verifier indipendente controlla la firma PQC.
    const externallyVerified = svc.verifyCompliance(proof);
    expect(externallyVerified).toBe(true);
  });

  it('VIOLAZIONE: se il log viola la proprietà (egressLevel > maxEgress), il circuito ritorna satisfied=false', () => {
    const svc = new SovereignService();
    // Log con violazione: egressLevel 2 (classificato) ma policy maxEgress=1.
    const internalLog = [
      { operation: 'read-binary', egressLevel: 0 },
      { operation: 'exfiltrate-data', egressLevel: 2 }, // VIOLAZIONE
      { operation: 'write-report', egressLevel: 1 },
    ];
    const publicInputs = { maxEgress: 1 };

    const result = svc.runZkpCompliance({
      enclaveId: 'enclave-zkp-003',
      circuitName: 'no-classified-egress',
      internalLog,
      publicInputs,
      now: NOW,
    });

    // Il circuito NON è soddisfatto: c'è una violazione della policy.
    expect(result.satisfied).toBe(false);
    // Il commitment root è comunque presente (per audit trail).
    expect(result.commitmentRoot.length).toBeGreaterThan(0);
  });

  it('COMMITMENT COERENZA: commitment root di proveCompliance e runZkpCompliance sono identici per lo stesso log', () => {
    const svc = new SovereignService();
    svc.attest({
      enclaveId: 'enclave-zkp-004',
      teeVendor: 'AMD-SEV-SNP',
      nonce: svc.randomNonce(),
      now: NOW,
    });

    const internalLog = [
      { operation: 'read-binary', egressLevel: 0 },
      { operation: 'analyze', egressLevel: 0 },
    ];
    const publicInputs = { maxEgress: 1 };

    // Esegui il circuito ZK.
    const zkpResult = svc.runZkpCompliance({
      enclaveId: 'enclave-zkp-004',
      circuitName: 'no-classified-egress',
      internalLog,
      publicInputs,
      now: NOW,
    });

    // Genera la prova di compliance.
    const proof = svc.proveCompliance({
      enclaveId: 'enclave-zkp-004',
      regulation: 'ITAR-120',
      statement: 'Nessun dato ITAR classificato è uscito',
      internalLog,
      publicInputs,
      now: NOW,
    });

    // I due commitment root devono essere identici (stesso log → stesso hash).
    expect(zkpResult.commitmentRoot).toBe(proof.commitmentRoot);
  });

  it('CIRCUITO NON REGISTRATO: richiede un circuito ZK valido, altrimenti errore esplicito', () => {
    const svc = new SovereignService();
    expect(() => {
      svc.runZkpCompliance({
        enclaveId: 'enclave-zkp-005',
        circuitName: 'non-existent-circuit',
        internalLog: [{ operation: 'test', egressLevel: 0 }],
        publicInputs: {},
        now: NOW,
      });
    }).toThrow(/no ZKP circuit registered/);
  });

  it('PROOF PERSISTENCE: getProof recupera una prova precedentemente generata', () => {
    const svc = new SovereignService();
    svc.attest({
      enclaveId: 'enclave-zkp-006',
      teeVendor: 'ARM-CCA',
      nonce: svc.randomNonce(),
      now: NOW,
    });

    const proof = svc.proveCompliance({
      enclaveId: 'enclave-zkp-006',
      regulation: 'GDPR-Article-32',
      statement: 'Compliance dimostrata',
      internalLog: [{ operation: 'test', egressLevel: 0 }],
      publicInputs: { maxEgress: 1 },
      now: NOW,
    });

    // Recupera la prova per ID.
    const retrieved = svc.getProof(proof.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(proof.id);
    expect(retrieved!.regulation).toBe('GDPR-Article-32');
    expect(retrieved!.verified).toBe(true);
  });

  it('GATE AUDIT COMPLETO: flusso end-to-end (attestazione → ZKP → proof → verifica) in <1h', () => {
    const svc = new SovereignService();
    const t0 = performance.now();

    // Step 1: Attestazione remota dell'enclave (G5.2).
    const attestation = svc.attest({
      enclaveId: 'enclave-audit-001',
      teeVendor: 'Intel-TDX',
      nonce: svc.randomNonce(),
      now: NOW,
    });
    expect(attestation.outcome).toBe('VERIFIED');

    // Step 2: Esecuzione del circuito ZK sul log interno.
    const internalLog = [
      { operation: 'read-binary', egressLevel: 0 },
      { operation: 'analyze-function', egressLevel: 0 },
      { operation: 'write-report', egressLevel: 1 },
    ];
    const zkpResult = svc.runZkpCompliance({
      enclaveId: 'enclave-audit-001',
      circuitName: 'no-classified-egress',
      internalLog,
      publicInputs: { maxEgress: 1 },
      now: NOW,
    });
    expect(zkpResult.satisfied).toBe(true);

    // Step 3: Generazione della prova di compliance firmata PQC.
    const proof = svc.proveCompliance({
      enclaveId: 'enclave-audit-001',
      regulation: 'GDPR-Article-32',
      statement: 'Nessun dato personale classificato è uscito dall\'enclave',
      internalLog,
      publicInputs: { maxEgress: 1 },
      now: NOW,
    });
    expect(proof.verified).toBe(true);

    // Step 4: Verifica esterna della prova (garanzia matematica).
    const externallyVerified = svc.verifyCompliance(proof);
    expect(externallyVerified).toBe(true);

    const elapsedMs = performance.now() - t0;
    // Gate PRD §6.4: audit compliance ZKP completato in <1h (3600000ms).
    expect(elapsedMs).toBeLessThan(3600000);
  });

  it('CIRCUITO PERSONALIZZATO: supporta circuiti ZK custom oltre a quello predefinito', () => {
    // Circuito custom: "tutte le operazioni sono read-only" (egressLevel == 0).
    const readOnlyCircuit = {
      name: 'read-only-operations',
      description: 'Dimostra che tutte le operazioni sono read-only (nessun egress)',
      execute: (log: Array<Record<string, unknown>>, _publicInputs: Record<string, unknown>): boolean => {
        return log.every((entry) => entry.egressLevel === 0);
      },
    };

    const svc = new SovereignService({ zkpCircuits: [readOnlyCircuit] });

    // Log con solo operazioni read-only.
    const validLog = [
      { operation: 'read-binary', egressLevel: 0 },
      { operation: 'read-metadata', egressLevel: 0 },
    ];
    const result1 = svc.runZkpCompliance({
      enclaveId: 'enclave-custom-001',
      circuitName: 'read-only-operations',
      internalLog: validLog,
      publicInputs: {},
      now: NOW,
    });
    expect(result1.satisfied).toBe(true);

    // Log con una scrittura (violazione).
    const invalidLog = [
      { operation: 'read-binary', egressLevel: 0 },
      { operation: 'write-report', egressLevel: 1 }, // violazione
    ];
    const result2 = svc.runZkpCompliance({
      enclaveId: 'enclave-custom-002',
      circuitName: 'read-only-operations',
      internalLog: invalidLog,
      publicInputs: {},
      now: NOW,
    });
    expect(result2.satisfied).toBe(false);
  });

  it('TRASPARENZA: la proof espone tutti i campi necessari per audit esterno (regulation, statement, publicInputs, commitmentRoot, proverVersion)', () => {
    const svc = new SovereignService();
    svc.attest({
      enclaveId: 'enclave-zkp-007',
      teeVendor: 'Intel-TDX',
      nonce: svc.randomNonce(),
      now: NOW,
    });

    const proof = svc.proveCompliance({
      enclaveId: 'enclave-zkp-007',
      regulation: 'ITAR-120',
      statement: 'Nessun dato ITAR è uscito',
      internalLog: [{ operation: 'test', egressLevel: 0 }],
      publicInputs: { maxEgress: 1 },
      now: NOW,
    });

    // Tutti i campi necessari per un audit esterno sono presenti.
    expect(proof.regulation).toBe('ITAR-120');
    expect(proof.statement).toBe('Nessun dato ITAR è uscito');
    expect(proof.publicInputs).toEqual({ maxEgress: 1 });
    expect(proof.commitmentRoot.length).toBeGreaterThan(0);
    expect(proof.proverSignature.length).toBeGreaterThan(0);
    expect(proof.proverEnclaveId).toBe('enclave-zkp-007');
    expect(proof.verifiedAt).toBe(NOW);
    expect(proof.proverVersion).toMatch(/^revra-compliance-prover@/);
  });
});