/**
 * A4 — Fuzzing API strutturato: genera payload malformati (null, undefined,
 * tipi sbagliati, stringhe enormi, JSON annidato patologico, buffer binari)
 * su ogni endpoint POST e asserisce ZERO crash (nessun 500 non gestito /
 * nessun timeout / nessun throw che buca il framework). Gate A4: fuzz run
 * pulito = nessuna vulnerabilità DoS/Tampering da input malformato.
 *
 * Questo è un fuzzer deterministico a corpus fisso (riproducibile in CI),
 * non un fuzzer coverage-guided infinito: sufficiente come gate A4
 * misurabile; un fuzzer ≥24h continuo gira in produzione (roadmap A4 gate
 * completo). Allineato al PRD §6.4 "fuzzing formale, non solo pentest".
 */
import 'reflect-metadata';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureRevraApp } from '../src/app.setup.js';
import { JwtAuthService } from '../src/auth/auth.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { MetricsRegistry } from '../src/observability/metrics.js';

process.env.REVRA_DB = join(mkdtempSync(join(tmpdir(), 'revra-fuzz-')), 'state.db');

let app: INestApplication;

// Tutti gli endpoint POST dell'API (inventory completo per fuzzing).
const POST_ENDPOINTS = [
  '/analysis/results',
  '/formats/route',
  '/formats/analyze',
  '/epistemic/patterns',
  '/epistemic/hypotheses/generate',
  '/epistemic/causal/observations',
  '/timeline/branches',
  '/timeline/merge',
  '/cognitive/states',
  '/cognitive/bci/adapters',
  '/sovereign/tenants/keys',
  '/sovereign/attestations',
  '/sovereign/compliance/proofs',
];

// Corpus di payload malformati (deterministico, riproducibile).
const FUZZ_PAYLOADS: unknown[] = [
  null,
  undefined,
  '',
  'not-json',
  42,
  true,
  [],
  {},
  { __proto__: { polluted: true } }, // prototype pollution attempt
  { constructor: { prototype: { polluted: true } } },
  { a: { b: { c: { d: { e: { f: 'deep' } } } } } }, // deeply nested
  { giant: 'x'.repeat(100_000) }, // large string
  { arr: new Array(10_000).fill('x') }, // large array
  { nan: NaN, inf: Infinity, negInf: -Infinity }, // special numbers
  { unicode: '🔥💀🚨'.repeat(1000) }, // unicode stress
  { binary: Buffer.from([0x00, 0xff, 0x7f, 0x80]).toString('base64') },
  { recursive: {} }, // placeholder, filled below
];
// Self-reference safe: non creiamo cicli reali (JSON.stringify li romperebbe),
// ma un oggetto con molte chiavi.
(FUZZ_PAYLOADS[FUZZ_PAYLOADS.length - 1] as { recursive: Record<string, string> }).recursive =
  Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, `v${i}`]));

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureRevraApp(app, {
    jwt: moduleRef.get(JwtAuthService),
    audit: moduleRef.get(AuditService),
    metrics: new MetricsRegistry(),
  });
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env.REVRA_DB;
});
describe('A4 — Fuzzing API strutturato (zero crash su payload malformati)', () => {
  it('nessun endpoint POST crasha (500 non gestito) o time-outta su payload malformati', async () => {
    const violations: string[] = [];
    for (const endpoint of POST_ENDPOINTS) {
      for (let i = 0; i < FUZZ_PAYLOADS.length; i++) {
        const payload = FUZZ_PAYLOADS[i];
        try {
          // Invia sempre come body JSON grezzo: supertest.send(scalare) chiamerebbe
          // Buffer.from(scalare) sul CLIENT e lancerebbe TypeError prima della request.
          // Stringificando noi, lo scalare arriva al server dove il filtro globale A4
          // lo traduce in 4xx (MALFORMED_INPUT/INVALID_PAYLOAD), mai 500.
          const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('content-type', 'application/json')
            .send(rawBody)
            .timeout({ response: 5_000 });
          // Accettabile: qualsiasi 4xx (validazione rifiuta) o 2xx.
          // NON accettabile: 500 non gestito (crash del framework / throw bucato).
          if (res.status >= 500) {
            violations.push(`${endpoint} payload#${i} → ${res.status}`);
          }
        } catch (err) {
          // Timeout di rete o connection reset = violazione (DoS via hang).
          violations.push(`${endpoint} payload#${i} → threw: ${(err as Error).message}`);
        }
      }
    }
    // Gate A4: zero violazioni (nessun 500, nessun crash, nessun hang).
    expect(violations, `fuzz violations: ${violations.join('; ')}`).toEqual([]);
  });

  it('path traversal / injection nei path param: nessun 500', async () => {
    const nastyIds = ['../../../etc/passwd', '%00', "' OR 1=1 --", '<script>', 'a'.repeat(10_000)];
    const violations: string[] = [];
    for (const id of nastyIds) {
      for (const endpoint of ['/analysis/results', '/timeline/results', '/sovereign/compliance/proofs']) {
        try {
          const res = await request(app.getHttpServer())
            .get(`${endpoint}/${encodeURIComponent(id)}`)
            .timeout({ response: 5_000 });
          if (res.status >= 500) violations.push(`${endpoint}/${id} → ${res.status}`);
        } catch (err) {
          violations.push(`${endpoint}/${id} → threw`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});