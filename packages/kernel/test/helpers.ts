import type { Actor, SubmitResultInput } from '@revra/contracts';
import type { ProofVerifier, VerifierRun } from '../src/verifier/types.js';

export const ACTORS = {
  ai: { kind: 'ai', id: 'neural-proposer' },
  symbolic: { kind: 'symbolic', id: 'type-inference-engine' },
  system: { kind: 'system', id: 'revra-kernel' },
  analyst: { kind: 'analyst', id: 'analyst-1' },
  engine: { kind: 'engine', id: 'ghidra-headless' },
} satisfies Record<string, Actor>;

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

export function submitInput(overrides: Partial<SubmitResultInput> = {}): SubmitResultInput {
  return {
    binaryHash: 'a1b2c3d4e5f60718',
    arch: 'x86_64',
    addressRange: { start: '0x401000', end: '0x4010ff' },
    engineSource: 'ghidra',
    claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 1; }' } },
    ...overrides,
  };
}

/** Controllable verifier: returns the outcome it was constructed with. */
export class MockVerifier implements ProofVerifier {
  readonly name = 'mock-verifier';
  readonly version = '0.0.0';
  readonly calls: string[] = [];

  constructor(private readonly outcome: VerifierRun['outcome']) {}

  async verify(cert: { theorem: string }): Promise<VerifierRun> {
    this.calls.push(cert.theorem);
    return { outcome: this.outcome, detail: 'mock' };
  }
}
