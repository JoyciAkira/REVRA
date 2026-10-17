/**
 * Security contracts (PRD §3.4 enterprise, §6.4 multi-tenancy): ruoli RBAC e
 * contesto tenant portato dal token JWT firmato.
 */
import { z } from 'zod';

export const TENANT_ROLES = ['admin', 'analyst', 'viewer'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const tenantContextSchema = z.object({
  tenantId: z.string().min(1),
  role: z.enum(TENANT_ROLES),
});
export type TenantContext = z.infer<typeof tenantContextSchema>;

export const tokenIssueSchema = z.object({
  tenantId: z.string().min(1),
  role: z.enum(TENANT_ROLES),
  /** Durata in secondi (default 43200 = 12h). */
  ttlSeconds: z.number().int().positive().max(2_592_000).optional(),
});
