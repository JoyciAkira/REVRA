/**
 * Auth middleware (F0.2): verify del token JWT, iniezione del tenant nel body
 * (fonte: token firmato — mai il client), RBAC viewer read-only.
 * Risposte 401/403 dirette con codici contratto; nessuna DI Nest nel path.
 */
import type { Request, Response } from 'express';
import type { JwtAuthService } from './auth.service.js';

interface AuthedRequest extends Request {
  tenant?: { tenantId: string; role: string };
}

export function authMiddleware(auth: JwtAuthService, secureMode: boolean): (req: Request, res: Response, next: () => void) => void {
  return (req: Request, res: Response, next: () => void): void => {
    // Open mode (nessun secret configurato): nessun enforcement (dev/CI).
    if (!secureMode) {
      next();
      return;
    }
    // L'emissione del primo token è l'unico endpoint pubblico.
    if (req.path.startsWith('/auth/')) {
      next();
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'bearer token mancante' } });
      return;
    }
    let tenant: { tenantId: string; role: string };
    try {
      const verified = auth.verify(header.slice(7));
      tenant = { tenantId: verified.tenantId, role: verified.role };
    } catch (error) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: error instanceof Error ? error.message : 'token non valido' },
      });
      return;
    }

    (req as AuthedRequest).tenant = tenant;
    if (req.body && typeof req.body === 'object' && 'result' in req.body) {
      const body = req.body as { result?: { tenantId?: string } };
      if (body.result && typeof body.result === 'object') {
        body.result.tenantId = tenant.tenantId;
      }
    }
    // A2: viewer read-only su TUTTI i moduli (non solo analysis).
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && tenant.role === 'viewer') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ruolo viewer: sola lettura' } });
      return;
    }
    // A2: ownership coerente su ogni risorsa che espone :tenantId nel path.
    // Priorità sul blocco provisioning: un analyst che tocca un tenant altrui
    // vede TENANT_MISMATCH (violazione isolamento) prima del FORBIDDEN generico.
    const pathTenantMatch = req.path.match(/\/tenants\/([^/]+)/);
    if (pathTenantMatch && pathTenantMatch[1] !== tenant.tenantId && tenant.role !== 'admin') {
      res.status(403).json({ error: { code: 'TENANT_MISMATCH', message: 'la risorsa appartiene a un altro tenant' } });
      return;
    }
    // F0.4: il provisioning di chiavi PQC è riservato ad admin.
    if (req.method === 'POST' && req.path.startsWith('/sovereign/tenants') && tenant.role !== 'admin') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'provisioning chiavi PQC riservato ad admin' } });
      return;
    }
    next();
  };
}
