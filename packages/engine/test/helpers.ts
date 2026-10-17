import type { Actor, SubmitResultInput } from '@revra/contracts';

export const ACTORS = {
  ai: { kind: 'ai', id: 'neural-proposer' },
  symbolic: { kind: 'symbolic', id: 'type-inference-engine' },
  system: { kind: 'system', id: 'revra-kernel' },
  analyst: { kind: 'analyst', id: 'analyst-1' },
  engine: { kind: 'engine', id: 'ghidra-headless' },
} satisfies Record<string, Actor>;

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
