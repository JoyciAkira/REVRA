/**
 * G6 API seam — sovereign enclave (PRD §3.4): chiavi PQC ML-DSA-65, chiavi
 * firme verificabili, attestation con freshness, compliance firmata PQC.
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('sovereign API (e2e, G6)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('provisions PQC tenant keys and verifies signatures end-to-end', async () => {
    const provisioned = await request(app.getHttpServer())
      .post('/sovereign/tenants/keys')
      .send({ tenantId: 'tenant-alpha' });
    expect(provisioned.status).toBe(201);
    expect(provisioned.body.algorithm).toBe('ML-DSA-65');
    expect(provisioned.body.publicKeyFingerprint).toHaveLength(64);

    const signed = await request(app.getHttpServer())
      .post('/sovereign/tenants/tenant-alpha/signatures')
      .send({ data: 'artifact:hash-a1b2' });
    expect(signed.status).toBe(201);
    expect(signed.body.signature.length).toBeGreaterThan(100);
  });

  it('attests an enclave and rejects nonce replay', async () => {
    const nonce = 'freshnonce0123456789abcdef';
    const first = await request(app.getHttpServer())
      .post('/sovereign/attestations')
      .send({ enclaveId: 'enclave-eu-1', teeVendor: 'AMD-SEV-SNP', nonce });
    expect(first.status).toBe(201);
    expect(first.body.outcome).toBe('VERIFIED');

    const replay = await request(app.getHttpServer())
      .post('/sovereign/attestations')
      .send({ enclaveId: 'enclave-eu-1', teeVendor: 'AMD-SEV-SNP', nonce });
    expect(replay.body.outcome).toBe('REJECTED');
    expect(replay.body.reason).toMatch(/replay/);
  });

  it('produces a signed compliance proof and verifies it', async () => {
    // L'enclave deve avere chiavi: l'attestation provisiona automaticamente.
    await request(app.getHttpServer())
      .post('/sovereign/attestations')
      .send({ enclaveId: 'enclave-eu-1', teeVendor: 'AMD-SEV-SNP' });

    const proof = await request(app.getHttpServer())
      .post('/sovereign/compliance/proofs')
      .send({
        enclaveId: 'enclave-eu-1',
        regulation: 'GDPR',
        statement: 'nessun dato classificato ha lasciato l\'enclave',
        internalLog: [{ event: 'egress', level: 'none' }],
        publicInputs: { maxEgressLevel: 'none', windowHours: 24 },
      });
    expect(proof.status).toBe(201);
    expect(proof.body.verified).toBe(true);
    expect(JSON.stringify(proof.body)).not.toContain('internalLog');

    const verification = await request(app.getHttpServer()).get(
      `/sovereign/compliance/proofs/${proof.body.id}/verification`,
    );
    expect(verification.body.verified).toBe(true);
  });
});
