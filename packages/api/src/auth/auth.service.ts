/**
 * JWT HS256 con node:crypto (zero dipendenze). Firma il contesto tenant:
 * {tenantId, role, exp}. Open mode (nessun REVRA_JWT_SECRET) = nessuna auth,
 * pensato per dev/CI locale — in produzione il secret è obbligatorio e la
 * emissione passa da un IdP (questo endpoint diventa solo interno).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TenantContext, TenantRole } from '@revra/contracts';

export interface VerifiedToken extends TenantContext {
  exp: number;
}

const DEFAULT_TTL_SECONDS = 43_200;

@Injectable()
export class JwtAuthService {
  private readonly secret: string | undefined = process.env.REVRA_JWT_SECRET;

  /** Secure mode: attivo solo quando il secret è configurato. */
  get secureMode(): boolean {
    return Boolean(this.secret);
  }

  issue(tenantId: string, role: TenantRole, ttlSeconds = DEFAULT_TTL_SECONDS): { token: string; expiresAt: string } {
    if (!this.secret) {
      throw new Error('REVRA_JWT_SECRET non configurato: emissione token non disponibile in open mode');
    }
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      tenantId,
      role,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = createHmac('sha256', this.secret).update(signingInput).digest('base64url');
    const token = `${signingInput}.${signature}`;
    return { token, expiresAt: new Date(payload.exp * 1000).toISOString() };
  }

  verify(token: string): VerifiedToken {
    if (!this.secret) {
      throw new Error('open mode: nessuna verifica disponibili');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('token malformato');
    }
    const [head, body, signature] = parts as [string, string, string];
    const expected = createHmac('sha256', this.secret).update(`${head}.${body}`).digest();
    const received = Buffer.from(signature, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new Error('firma token non valida');
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      tenantId?: unknown;
      role?: unknown;
      exp?: unknown;
    };
    if (typeof payload.tenantId !== 'string' || typeof payload.role !== 'string' || typeof payload.exp !== 'number') {
      throw new Error('payload token incompleto');
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('token scaduto');
    }
    return { tenantId: payload.tenantId, role: payload.role as TenantRole, exp: payload.exp };
  }
}

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
