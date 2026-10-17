/**
 * Persistenza seam (F0.1): lo snapshot kernel sopravvive a un "riavvio"
 * (export → nuovo kernel → restore) e lo store SQLite lo conserva su file.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { SqliteStateStore } from '../src/persistence/sqlite.js';
import { kernelSnapshotSchema } from '../src/persistence/types.js';
import { ACTORS, submitInput } from './helpers.js';

const SYSTEM: { kind: 'system'; id: string } = { kind: 'system', id: 'revra-kernel' };

/** Verifier sempre VERIFIED + certificato sul result indicato. */
async function attachVerified(kernel: EvidenceKernel, result: { id: string; binaryHash: string; arch: string; addressRange: { start: string; end: string } }): Promise<void> {
  kernel.useVerifier({ name: 'v', version: '0', verify: async () => ({ outcome: 'VERIFIED' }) });
  await kernel.attachCertificate(
    {
      resultId: result.id,
      theorem: 'semantic-preservation',
      proofTerm: 'theorem t : True := trivial',
      semanticModel: 'lean4-imp-semantics@0.1',
      property: 'p',
      assumptions: [],
      binaryHash: result.binaryHash,
      instructionRange: result.addressRange,
      arch: result.arch,
    },
    SYSTEM,
  );
}

function seededKernel(): EvidenceKernel {
  const kernel = new EvidenceKernel();
  const a = kernel.submit(submitInput(), ACTORS.ai);
  kernel.submit(submitInput({ engineSource: 'radare2' }), ACTORS.ai);
  kernel.promote(a.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://persist-1' });
  kernel.degrade(a.id, 'VERIFICATION_TIMEOUT', ACTORS.system);
  const aState = kernel.getResult(a.id)!;
  void attachVerified(kernel, aState);
  return kernel;
}

describe('kernel snapshot round-trip', () => {
  it('restores the full universe: results, certificates, reconciliations, counters', async () => {
    const first = await seededKernel();

    const snapshot = first.exportState();
    // JSON-safe per definizione: passa dal serializzatore.
    const restored = new EvidenceKernel();
    restored.restore(kernelSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot))));

    expect(restored.listResults().length).toBe(first.listResults().length);
    const original = first.listResults()[0]!;
    const copy = restored.getResult(original.id)!;
    expect(copy.verification).toEqual(original.verification);
    expect(restored.getProvenance(original.id)).toEqual(first.getProvenance(original.id));
    expect(restored.getCertificate(original.id)?.outcome).toBe('VERIFIED');
    expect(restored.coverage()).toEqual(first.coverage());
    expect(restored.listReconciliations()).toEqual(first.listReconciliations());
  });

  it('continues generating non-colliding ids after restore', async () => {
    const first = await seededKernel();
    const known = new Set(first.listResults().map((r) => r.id));
    const snapshot = first.exportState();

    const restored = new EvidenceKernel();
    restored.restore(snapshot);
    const fresh = restored.submit(submitInput({ engineSource: 'jadx' }), ACTORS.ai);

    expect(known.has(fresh.id)).toBe(false);
  });

  it('refuses a corrupted snapshot (schema validation at the boundary)', () => {
    const restored = new EvidenceKernel();
    expect(() =>
      restored.restore({ version: 1, seq: -1, records: [], certificates: [], reconciliations: [] } as never),
    ).toThrowError();
  });
});

describe('SqliteStateStore', () => {
  it('persists snapshots per namespace across store instances (file on disk)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'revra-sqlite-'));
    const dbPath = join(dir, 'state.db');
    const storeA = new SqliteStateStore(dbPath);
    const kernel = new EvidenceKernel();
    const a = kernel.submit(submitInput(), ACTORS.ai);
    kernel.promote(a.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });
    storeA.save('kernel', kernel.exportState(), '2026-10-11T00:00:00.000Z');
    storeA.save('epistemic', { patterns: 3 }, '2026-10-11T00:00:00.000Z');
    storeA.close();

    const storeB = new SqliteStateStore(dbPath);
    const loaded = storeB.load('kernel') as { records: unknown[] };
    expect(loaded.records).toHaveLength(1);
    expect(storeB.load('epistemic')).toEqual({ patterns: 3 });
    expect(storeB.load('timeline')).toBeNull();
    storeB.close();
  });
});
