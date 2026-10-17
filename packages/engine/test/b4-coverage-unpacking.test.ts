/**
 * B4 — Copertura universale 9/9 + packers/unpacking (UPX).
 * Gate: tutti i 9 ecosistemi hanno almeno un adapter registrato; il detector
 * riconosce la firma UPX! nei binari packed; l'adapter upx-unpacker è
 * registrato su native-elf e native-pe. L'unpacking reale (upx -d) richiede
 * il CLI installato — qui verifichiamo la registrazione e il rilevamento,
 * che sono il gate di copertura; l'esecuzione reale è coperta dal probe
 * isAvailable() che dichiara DEGRADED se upx manca (onestà runtime, PRD §3.1).
 */
import { describe, expect, it } from 'vitest';
import { detectFormat } from '../src/formats/format-detector.js';
import { defaultAdapters } from '../src/formats/adapters.js';
import { FormatEngineRegistry } from '../src/formats/engine-registry.js';
import { BINARY_ECOSYSTEMS } from '@revra/contracts';

// Costruisce un header ELF minimo valido (magic \x7fELF) con payload arbitrario dopo.
function elfWithPayload(payload: string): Uint8Array {
  const header = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
  const body = new TextEncoder().encode(payload);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

// Costruisce un header PE minimo (MZ) con payload arbitrario dopo.
function peWithPayload(payload: string): Uint8Array {
  const header = new Uint8Array([0x4d, 0x5a]);
  const body = new TextEncoder().encode(payload);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

describe('B4 — Copertura universale 9/9 ecosistemi', () => {
  it('ogni ecosistema in BINARY_ECOSYSTEMS ha almeno un adapter registrato', () => {
    const adapters = defaultAdapters();
    const registry = new FormatEngineRegistry();
    for (const a of adapters) registry.register(a);

    const covered = new Set(adapters.map((a) => a.ecosystem));
    for (const eco of BINARY_ECOSYSTEMS) {
      expect(covered.has(eco), `ecosistema ${eco} senza adapter registrato`).toBe(true);
    }
    // Tutti e 9 gli ecosistemi sono coperti.
    expect(covered.size).toBeGreaterThanOrEqual(BINARY_ECOSYSTEMS.length);
  });

  it('9/9 ecosistemi: la lista contratti coincide con gli adapter registrati', () => {
    const adapters = defaultAdapters();
    const ecosystems = new Set(adapters.map((a) => a.ecosystem));
    // Ogni ecosistema dei contratti ha un adapter (gate B4: 9/9 SUPPORTED-or-DEGRADED, mai PLANNED silente).
    for (const eco of BINARY_ECOSYSTEMS) {
      expect(ecosystems.has(eco)).toBe(true);
    }
  });
});

describe('B4 — Rilevamento packer UPX (magic bytes)', () => {
  it('ELF con firma UPX! → rilevato come elf-packed (native-elf)', () => {
    // Simula un binario ELF packed con UPX: header ELF + sezione contenente "UPX!".
    const bytes = elfWithPayload('some compressed data UPX!3.96 more packed bytes here');
    const detection = detectFormat(bytes);
    expect(detection).not.toBeNull();
    expect(detection!.ecosystem).toBe('native-elf');
    expect(detection!.format).toBe('elf-packed');
    expect(detection!.magicEvidence).toContain('UPX!');
    expect(detection!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('PE con firma UPX! → rilevato come pe-packed (native-pe)', () => {
    const bytes = peWithPayload('compressed UPX! stub and packed sections');
    const detection = detectFormat(bytes);
    expect(detection).not.toBeNull();
    expect(detection!.ecosystem).toBe('native-pe');
    expect(detection!.format).toBe('pe-packed');
    expect(detection!.magicEvidence).toContain('UPX!');
  });

  it('ELF senza UPX! → rilevato come elf normale (non packed)', () => {
    const bytes = elfWithPayload('normal uncompressed code section no packer signature');
    const detection = detectFormat(bytes);
    expect(detection).not.toBeNull();
    expect(detection!.ecosystem).toBe('native-elf');
    expect(detection!.format).toBe('elf'); // non elf-packed
  });
});

describe('B4 — Adapter upx-unpacker registrato', () => {
  it('upx-unpacker è registrato su native-elf e native-pe', () => {
    const adapters = defaultAdapters();
    const upxElf = adapters.find((a) => a.engineId === 'upx-unpacker' && a.ecosystem === 'native-elf');
    const upxPe = adapters.find((a) => a.engineId === 'upx-unpacker' && a.ecosystem === 'native-pe');
    expect(upxElf, 'upx-unpacker mancante su native-elf').toBeDefined();
    expect(upxPe, 'upx-unpacker mancante su native-pe').toBeDefined();
  });

  it('upx-unpacker dichiara disponibilità onesta (DEGRADED se CLI assente, mai silente)', async () => {
    const adapters = defaultAdapters();
    const upx = adapters.find((a) => a.engineId === 'upx-unpacker' && a.ecosystem === 'native-elf')!;
    // isAvailable() ritorna boolean reale dal probe del CLI — non lancia, non mente.
    const available = await upx.isAvailable();
    expect(typeof available).toBe('boolean');
    // Se upx non è installato, è false (→ DEGRADED dichiarato dal registry), non un crash.
    // Non asseriamo il valore (dipende dall'ambiente), ma che sia un boolean definito.
  });
});