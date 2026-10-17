/**
 * G7 API seam — universal coverage (visione founder). Usa i DEFAULT adapters
 * installati sull'host: la matrice è viva, quindi gli assert sono
 * environment-honest (stati ∈ contratto; il wasm2wat presente qui è SUPPORTED
 * reale). La logica di detection/routing è coperta dagli unit test engine.
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

const ELF_BYTES = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]);
const UNKNOWN_BYTES = Buffer.from([0x13, 0x37, 0x13, 0x37]);

describe('formats API (e2e, universal coverage)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a live coverage matrix over all nine ecosystems', async () => {
    const matrix = await request(app.getHttpServer()).get('/formats/matrix');

    expect(matrix.status).toBe(200);
    expect(matrix.body.rows.length).toBeGreaterThanOrEqual(9);
    const statuses = matrix.body.rows.map((r: { status: string }) => r.status);
    for (const status of statuses) {
      expect(['SUPPORTED', 'DEGRADED', 'PLANNED', 'UNSUPPORTED']).toContain(status);
    }
    // Ogni ecosistema della matrice universale compare almeno una volta.
    const ecosystems = new Set(matrix.body.rows.map((r: { ecosystem: string }) => r.ecosystem));
    expect(ecosystems.size).toBe(9);
  });

  it('routes a real ELF binary and reports the routing honestly', async () => {
    const route = await request(app.getHttpServer())
      .post('/formats/route')
      .send({ binary: ELF_BYTES.toString('base64') });

    expect(route.status).toBe(200);
    expect(route.body.detection.ecosystem).toBe('native-elf');
    expect(route.body.detection.magicEvidence).toMatch(/7f 45 4c 46/);
    expect(['SUPPORTED', 'DEGRADED']).toContain(route.body.status);
  });

  it('answers UNSUPPORTED for unrecognized formats — never an invented label', async () => {
    const route = await request(app.getHttpServer())
      .post('/formats/route')
      .send({ binary: UNKNOWN_BYTES.toString('base64') });

    expect(route.status).toBe(200);
    expect(route.body.status).toBe('UNSUPPORTED');
    expect(route.body.reason).toMatch(/non riconosciuto/);
  });

  it('runs analyze end-to-end when an engine is available, or degrades explicitly', async () => {
    const analysis = await request(app.getHttpServer())
      .post('/formats/analyze')
      .send({ binary: ELF_BYTES.toString('base64'), binaryHash: 'a1b2c3d4e5f60718' });

    expect(analysis.status).toBe(201);
    if (analysis.body.routing.status === 'SUPPORTED') {
      expect(analysis.body.result.engineSource).toBeTruthy();
      expect(analysis.body.result.verification.state).toBe('L1');
    } else {
      expect(analysis.body.routing.status).toBe('DEGRADED');
      expect(analysis.body.reason).toBeTruthy();
      expect(analysis.body.result).toBeUndefined();
    }
  });

  it('validates the payload contract', async () => {
    const bad = await request(app.getHttpServer())
      .post('/formats/route')
      .send({ binary: 'abc' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_PAYLOAD');
  });
});
