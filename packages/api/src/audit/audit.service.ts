/**
 * Audit trail forense (PRD v1.0 acceptance, F0.2): append-only di ogni
 * mutazione con timestamp, tenant, metodo, path ed esito. Con REVRA_DB la
 * traccia è durevole su SQLite (F0.3); altrimenti in-memory.
 */
import { Injectable } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';

export interface AuditEntry {
  id: number;
  ts: string;
  tenantId: string;
  role: string;
  method: string;
  path: string;
  statusCode: number;
}

@Injectable()
export class AuditService {
  private readonly memory: AuditEntry[] = [];
  private nextId = 1;
  private db: DatabaseSync | undefined;

  /** REVRA_DB attivo → tabella audit_log durevole; altrimenti in-memory. */
  bindDatabase(dbPath: string | undefined): void {
    if (!dbPath) return;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY,
        ts TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        role TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL
      )
    `);
    const max = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_log').get() as { m: number };
    this.nextId = max.m + 1;
    // Le voci storiche restano consultabili anche via /audit/entries.
    const rows = this.db.prepare('SELECT id, ts, tenant_id, role, method, path, status_code FROM audit_log').all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      this.memory.push({
        id: row.id as number,
        ts: row.ts as string,
        tenantId: row.tenant_id as string,
        role: row.role as string,
        method: row.method as string,
        path: row.path as string,
        statusCode: row.status_code as number,
      });
    }
  }

  record(entry: Omit<AuditEntry, 'id'>): void {
    const full: AuditEntry = { id: this.nextId++, ...entry };
    this.memory.push(full);
    if (this.memory.length > 10_000) {
      this.memory.splice(0, this.memory.length - 10_000);
    }
    if (this.db) {
      this.db
        .prepare('INSERT INTO audit_log (id, ts, tenant_id, role, method, path, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(full.id, full.ts, full.tenantId, full.role, full.method, full.path, full.statusCode);
    }
  }

  /** Ultime N voci, più recente prima. */
  latest(limit = 100): AuditEntry[] {
    return [...this.memory].reverse().slice(0, limit);
  }
}
