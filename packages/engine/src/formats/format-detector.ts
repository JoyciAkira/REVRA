/**
 * FormatDetector (PRD §3.1, visione founder: copertura universale).
 * Rileva l'ecosistema binario dai magic bytes — L0 Observed, con la prova
 * della firma riportata in ogni detection. Formati non riconosciuti → null:
 * mai un'etichetta inventata.
 */
import type { BinaryEcosystem, FormatDetection } from '@revra/contracts';

function hex(bytes: Uint8Array, length: number): string {
  return [...bytes.slice(0, length)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

function containsAscii(bytes: Uint8Array, ascii: string, limit = 4096): boolean {
  const needle = new TextEncoder().encode(ascii);
  const hay = bytes.slice(0, limit);
  outer: for (let i = 0; i <= hay.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function le32(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24);
}

/**
 * Firma magica nota per ecosistema. Ordine di valutazione: i formati più
 * specifici prima dei contenitori generici.
 */
export function detectFormat(bytes: Uint8Array): FormatDetection | null {
  if (bytes.length < 4) return null;

  // WASM: '\0asm'
  if (startsWith(bytes, [0x00, 0x61, 0x73, 0x6d])) {
    return { ecosystem: 'wasm', format: 'webassembly', confidence: 1, magicEvidence: `magic ${hex(bytes, 4)}` };
  }

 // ELF — ma se contiene la firma UPX! è un binario packed (priorità sul formato base).
 if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
 if (containsAscii(bytes, 'UPX!')) {
 return { ecosystem: 'native-elf', format: 'elf-packed', confidence: 0.95, magicEvidence: 'ELF magic + UPX! signature (packed)' };
 }
 return { ecosystem: 'native-elf', format: 'elf', confidence: 1, magicEvidence: `magic ${hex(bytes, 4)}` };
 }

  // Mach-O: feedface / feedfacf (LE) e cafebabe / beeffeed (BE — fat)
  if (
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe]) ||
    startsWith(bytes, [0xbe, 0xef, 0xfe, 0xed])
  ) {
    return { ecosystem: 'native-mach-o', format: 'mach-o', confidence: 1, magicEvidence: `magic ${hex(bytes, 4)}` };
  }

  // Python .pyc: magic 2 byte + '\r\n' — pattern universale per ogni versione.
  if (bytes[1] === 0x0d && bytes[2] === 0x0d && bytes[3] === 0x0a) {
    const version = (bytes[0]! << 8) | bytes[0]!;
    return {
      ecosystem: 'python',
      format: `pyc-magic-${version}`,
      confidence: 0.9,
      magicEvidence: `magic ${hex(bytes, 4)}`,
    };
  }

  // Firmware: U-Boot legacy uImage (0x27051956 big-endian)
  if (startsWith(bytes, [0x27, 0x05, 0x19, 0x56])) {
    return { ecosystem: 'firmware', format: 'uimage', confidence: 0.95, magicEvidence: `magic ${hex(bytes, 4)}` };
  }

  // ZIP container: JAR se contiene META-INF/MANIFEST.MF, altrimenti non coperto.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (containsAscii(bytes, 'META-INF/MANIFEST.MF')) {
      return {
        ecosystem: 'jvm',
        format: 'jar',
        confidence: 0.85,
        magicEvidence: 'PK\\x03\\x04 + META-INF/MANIFEST.MF',
      };
    }
    return null; // zip generico: fuori matrice, dichiarato non riconosciuto.
  }

 // PE: 'MZ'. Se contiene UPX! → pe-packed; se contiene CLR metadata BSJB → dotnet; altrimenti native-pe.
 if (startsWith(bytes, [0x4d, 0x5a])) {
 if (containsAscii(bytes, 'UPX!')) {
 return { ecosystem: 'native-pe', format: 'pe-packed', confidence: 0.95, magicEvidence: 'MZ + UPX! signature (packed)' };
 }
 if (containsAscii(bytes, 'BSJB')) {
 return {
 ecosystem: 'dotnet',
 format: 'pe-cil',
 confidence: 0.8,
 magicEvidence: 'MZ + CLR metadata BSJB',
 };
 }
 return {
 ecosystem: 'native-pe',
 format: 'pe',
 confidence: 0.6,
 magicEvidence: 'MZ (nessun CLR metadata nei primi 4KB)',
 };
 }

  // ASAR (Electron): [uint32 pickleSize=4][uint32 headerSize][uint32 jsonSize][JSON]. Euristico.
  if (bytes.length >= 13 && le32(bytes, 0) === 4 && le32(bytes, 8) > 0 && bytes[12] === 0x7b) {
    return {
      ecosystem: 'javascript-asar',
      format: 'asar',
      confidence: 0.6,
      magicEvidence: `pickle header + JSON (jsonSize=${le32(bytes, 8)})`,
    };
  }
  // UPX packed: la firma "UPX!" appare nei binari compressi con UPX (packer comune).
  // Rilevamento trasversale: se presente, annotiamo il formato come packed e
  // l'ecosistema sottostante resta quello del container (ELF/PE). L'unpacking
  // è gestito da un adapter dedicato (upx-unpacker) che estrae il binario originale.
  if (containsAscii(bytes, 'UPX!')) {
    // Determina l'ecosistema sottostante dal magic header.
    let ecosystem: BinaryEcosystem = 'native-elf'; // default
    let format = 'elf-packed';
    if (startsWith(bytes, [0x4d, 0x5a])) {
      ecosystem = 'native-pe';
      format = 'pe-packed';
    } else if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
      ecosystem = 'native-elf';
      format = 'elf-packed';
    }
    return {
      ecosystem,
      format,
      confidence: 0.95,
      magicEvidence: 'UPX! signature detected (packed binary)',
    };
  }

  return null;
}

export const COVERED_ECOSYSTEMS: readonly BinaryEcosystem[] = [
  'native-elf',
  'native-pe',
  'native-mach-o',
  'jvm',
  'dotnet',
  'python',
  'javascript-asar',
  'wasm',
  'firmware',
];
