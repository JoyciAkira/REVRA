/**
 * F2 seam — Lean4CliVerifier reale: con la toolchain installata (elan) i
 * proofTerm vengono verificati da `lean` e i risultati possono raggiungere
 * L3 con certificato vero. Proof invalido → PROOF_FAILED → degradazione.
 */
import { describe, expect, it } from 'vitest';
import { Lean4CliVerifier } from '../src/verifier/lean4-cli.js';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, submitInput } from './helpers.js';

const leanAvailable = await Lean4CliVerifier.detect().then(
  (v) => v !== undefined,
  () => false,
);
const lean = leanAvailable ? (await Lean4CliVerifier.detect())! : undefined;

describe.skipIf(!leanAvailable)('Lean4CliVerifier (integration — richiede lean installato)', () => {
  it('detects the lean toolchain', async () => {
    expect(await Lean4CliVerifier.detect()).toBeDefined();
  });

  it('verifies a real Lean theorem', { timeout: 30_000 }, async () => {
    const run = await lean.verify({
      resultId: 'r',
      theorem: 'true-is-true',
      proofTerm: "theorem revra_ok : True := trivial",
      semanticModel: 'lean4-core',
      property: 'True',
      assumptions: [],
      binaryHash: 'a1b2c3d4e5f60718',
      instructionRange: { start: '0x0', end: '0x1' },
      arch: 'x86_64',
    });
    expect(run.outcome).toBe('VERIFIED');
  });

  it('rejects a broken proof as PROOF_FAILED (graceful degradation reale)', { timeout: 30_000 }, async () => {
    const run = await lean.verify({
      resultId: 'r',
      theorem: 'false-from-trivial',
      proofTerm: "theorem revra_bad : False := trivial",
      semanticModel: 'lean4-core',
      property: 'False',
      assumptions: [],
      binaryHash: 'a1b2c3d4e5f60718',
      instructionRange: { start: '0x0', end: '0x1' },
      arch: 'x86_64',
    });
    expect(run.outcome).toBe('PROOF_FAILED');
  });
});

describe('primo L3 end-to-end con certificato Lean reale', () => {
  it('L1 → L2 (simbolico) → L3 (Lean certificate) sul kernel', { timeout: 30_000 }, async () => {
    const kernel = new EvidenceKernel();
    const result = kernel.submit(submitInput(), { kind: 'ai', id: 'neural-proposer' });
    kernel.promote(result.id, 'L2', { kind: 'symbolic', id: 'structural' }, { evidenceRef: 'structural://1' });

    const detected = await Lean4CliVerifier.detect();
    if (!detected) {
      console.warn('lean non installato: skip L3 reale');
      return;
    }
    kernel.useVerifier(detected);

    const { result: proven } = await kernel.attachCertificate(
      {
        resultId: result.id,
        theorem: 'true-is-true',
        proofTerm: "theorem revra_ok : True := trivial",
        semanticModel: 'lean4-core',
        property: 'True',
        assumptions: [],
        binaryHash: result.binaryHash,
        instructionRange: result.addressRange,
        arch: result.arch,
      },
      { kind: 'system', id: 'revra-kernel' },
    );

    expect(proven.verification.state).toBe('L3');
    expect(kernel.getCertificate(result.id)?.verifier.name).toBe('lean4');
  });
});
