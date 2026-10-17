/**
 * SqliteStateStore (F0.1/F0.3): persistenza JSON per namespace su SQLite via
 * `node:sqlite` (nativo in Node 22+, zero dipendenze). Generico: ogni
 * sottosistema (kernel, epistemic, timeline…) ha il suo namespace; la
 * validazione dello schema spetta al sottosistema al restore.
 */
import { DatabaseSync } from 'node:sqlite';

export class SqliteStateStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (
        namespace TEXT PRIMARY KEY,
        snapshot TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  save(namespace: string, snapshot: unknown, now: string): void {
    this.db
      .prepare(
        `INSERT INTO state (namespace, snapshot, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(namespace) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
      )
      .run(namespace, JSON.stringify(snapshot), now);
  }

  /** null = nessuno snapshot salvato per il namespace (primo avvio). */
  load(namespace: string): unknown | null {
    const row = this.db.prepare('SELECT snapshot FROM state WHERE namespace = ?').get(namespace) as
      | { snapshot: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.snapshot) as unknown;
  }

  close(): void {
    this.db.close();
  }
}
