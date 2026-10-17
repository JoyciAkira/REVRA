/**
 * Il tenant arriva SOLO dal JwtGuard (token firmato) — questo helper estrae
 * il tenantId validato dalla request per il layer service.
 */
export function tenantIdFrom(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null || !('tenant' in request)) {
    return undefined;
  }
  const tenant = (request as { tenant?: unknown }).tenant;
  if (typeof tenant !== 'object' || tenant === null || !('tenantId' in tenant)) {
    return undefined;
  }
  const tenantId = tenant.tenantId;
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
}
