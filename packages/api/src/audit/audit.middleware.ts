/**
 * Audit middleware (F0.2): Express nativo, nessuna DI — registra ogni
 * mutazione POST con tenant (fonte: JwtGuard sulla request) ed esito.
 * Il listener 'finish' gira dopo l'handler: il tenant scritto dal guard
 * è già presente.
 */
import type { Request, Response } from 'express';
import { AuditService } from './audit.service.js';

interface TenantedRequest extends Request {
  tenant?: { tenantId?: string; role?: string };
}

function readTenant(request: TenantedRequest): { tenantId: string; role: string } {
  const tenant = request.tenant;
  if (tenant && typeof tenant.tenantId === 'string' && typeof tenant.role === 'string') {
    return { tenantId: tenant.tenantId, role: tenant.role };
  }
  return { tenantId: 'anonymous', role: 'anonymous' };
}

export function auditMiddleware(audit: AuditService): (req: Request, res: Response, next: () => void) => void {
  return (req: Request, res: Response, next: () => void): void => {
    // Solo mutazioni post-autenticazione: /auth/* è rumore pre-identità.
    if (req.method !== 'POST' || req.path.startsWith('/auth/')) {
      next();
      return;
    }
    res.on('finish', () => {
      const tenant = readTenant(req as TenantedRequest);
      audit.record({
        ts: new Date().toISOString(),
        tenantId: tenant.tenantId,
        role: tenant.role,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
      });
    });
    next();
  };
}
