/**
 * Behavioral testing REALE (PRD §3.1, M2): i candidati con codice macchina
 * vengono ESEGUITI in emulazione Unicorn e il verifier confronta l'output —
 * la promozione a L2 è empirica, con l'evidenza del run.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '@revra/kernel';
import { HybridDecompiler } from '../src/hybrid/hybrid-decompiler.js';
import { UnicornBehavioralVerifier } from '../src/behavioral/unicorn-verifier.js';
import { AsmBehavioralProposer } from '../src/behavioral/asm-proposer.js';

const CTX = { binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', addressRange: { start: '0x401000', end: '0x4010ff' } };

// mov eax, 60; ret — "exit(60)": output atteso EAX=60.
const ASM_HEX = 'b83c000000c3';

const unicornAvailable = new UnicornBehavioralVerifier().isAvailable();

describe.skipIf(!unicornAvailable)('UnicornBehavioralVerifier', () => {
  it('is available (unicorn python bindings installed)', async () => {
    const verifier = new UnicornBehavioralVerifier();
    expect(await verifier.isAvailable()).toBe(true);
  });

  it('emulates the machine code and confirms the correct prediction', async () => {
    const verifier = new UnicornBehavioralVerifier();
    const verdict = await verifier.verify(
      {
        claim: { kind: 'behavioral-case', payload: { asmBytesHex: ASM_HEX, expectedRax: 60 } },
        confidence: 0.9,
        modelId: 'asm',
        modelVersion: '0',
      },
      CTX,
    );
    expect(verdict.outcome).toBe('VERIFIED');
    expect(verdict.evidenceRef).toMatch(/^unicorn:\/\//);
  });

  it('emulates code extracted from a REAL ELF file (offset 0x78) and verifies EAX', async () => {
    const verifier = new UnicornBehavioralVerifier();
    // Costruisce un ELF x86-64 minimo deterministico in-memory (non dipende da /tmp effimero).
    // Layout: 0x78 byte di header/padding, poi il codice a offset 0x78.
    // Codice: mov eax,60 (b8 3c 00 00 00); ret (c3) — termina l'emulazione pulita.
    // (syscall + byte zero successivi causerebbero istruzioni invalid → INCONCLUSIVE in Unicorn.)
    const CODE_OFFSET = 0x78;
    const codeBytes = new Uint8Array([
      0xb8, 0x3c, 0x00, 0x00, 0x00, // mov eax, 60
      0xc3, // ret — ferma l'emulatore Unicorn in modo deterministico
    ]);
    const elf = new Uint8Array(CODE_OFFSET + codeBytes.length);
    // Magic ELF \x7fELF + classe 64-bit + little-endian + ABI SysV.
    elf[0] = 0x7f; elf[1] = 0x45; elf[2] = 0x4c; elf[3] = 0x46;
    elf[4] = 2; // ELFCLASS64
    elf[5] = 1; // ELFDATA2LSB
    elf[6] = 1; // EV_CURRENT
    elf.set(codeBytes, CODE_OFFSET);
    // Estrae il codice dall'offset 0x78 — esattamente come si farebbe su un ELF reale.
    const code = elf.subarray(CODE_OFFSET);
    // Uint8Array.subarray() NON ha .toString('hex') nativo (ritornerebbe decimal comma-separated).
    // Converto in Buffer di Node per ottenere l'hex corretto che lo script Python Unicorn si aspetta.
    const codeHex = Buffer.from(code).toString('hex');
    const verdict = await verifier.verify(
      {
        claim: {
          kind: 'behavioral-case',
          payload: { asmBytesHex: codeHex, expectedRax: 60 },
        },
        confidence: 0.9,
        modelId: 'asm',
        modelVersion: '0',
      },
      CTX,
    );
    expect(verdict.outcome).toBe('VERIFIED');
    expect(verdict.evidenceRef).toMatch(/^unicorn:\/\//);
  });

  it('refutes a wrong prediction with the observed value', async () => {
    const verifier = new UnicornBehavioralVerifier();
    const verdict = await verifier.verify(
      {
        claim: { kind: 'behavioral-case', payload: { asmBytesHex: ASM_HEX, expectedRax: 61 } },
        confidence: 0.8,
        modelId: 'asm',
        modelVersion: '0',
      },
      CTX,
    );
    expect(verdict.outcome).toBe('REFUTED');
    expect(verdict.reason).toMatch(/60 ≠ atteso 61/);
  });
});

describe.skipIf(!unicornAvailable)('HybridDecompiler con behavioral testing reale', () => {
  it('promotes L2 solo i candidati confermati dall\'emulazione e rifiuta gli altri', async () => {
    const kernel = new EvidenceKernel();
    const proposer = new AsmBehavioralProposer([
      { asmBytesHex: ASM_HEX, expectedRax: 60 }, // predizione corretta
      { asmBytesHex: ASM_HEX, expectedRax: 61 }, // predizione errata
      { asmBytesHex: ASM_HEX, expectedRax: 60 }, // corretta
    ]);
    const hybrid = new HybridDecompiler({
      kernel,
      proposer,
      verifier: new UnicornBehavioralVerifier(),
    });

    const report = await hybrid.run(CTX);

    expect(report.candidates.map((c) => c.outcome)).toEqual([
      'VERIFIED_PROMOTED',
      'REFUTED',
      'VERIFIED_PROMOTED',
    ]);
    const promoted = kernel.getResult(report.candidates[0]!.resultId)!;
    expect(promoted.verification.state).toBe('L2');
    expect(promoted.verification.warnings).toEqual([]);

    const refuted = kernel.getResult(report.candidates[1]!.resultId)!;
    expect(refuted.verification.warnings).toContain('REFUTED');

    const metrics = hybrid.metricsSnapshot();
    expect(metrics.firstAttemptCorrectness).toBeCloseTo(2 / 3);
  });
});
