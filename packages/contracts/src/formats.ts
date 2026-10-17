/**
 * Universal coverage contracts (visione founder: ogni binario compilato da
 * qualunque linguaggio/framework/ambiente). Il formato è cittadino di prima
 * classe: rilevato dai magic bytes, instradato all'engine giusto, con
 * capability dichiarate esplicitamente — SUPPORTED solo con prova di
 * benchmark, DEGRADED se il tool manca, PLANNED/UNSUPPORTED mai nascosti
 * (PRD §3.1: la copertura si dichiara, non si promette).
 */
import { z } from 'zod';

/** Ecosistemi binari coperti dalla matrice universale. */
export const BINARY_ECOSYSTEMS = [
  'native-elf',
  'native-pe',
  'native-mach-o',
  'jvm',
  'dotnet',
  'python',
  'javascript-asar',
  'wasm',
  'firmware',
] as const;
export type BinaryEcosystem = (typeof BINARY_ECOSYSTEMS)[number];

export const CAPABILITY_STATUSES = ['SUPPORTED', 'DEGRADED', 'PLANNED', 'UNSUPPORTED'] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const capabilitySchema = z.object({
  ecosystem: z.enum(BINARY_ECOSYSTEMS),
  engineId: z.string().min(1),
  engineVersion: z.string(),
  status: z.enum(CAPABILITY_STATUSES),
  /** Riferimento al benchmark parity (richiesto per SUPPORTED — PRD §6.1). */
  benchmarkRef: z.string().optional(),
  reason: z.string().optional(),
});
export type Capability = z.infer<typeof capabilitySchema>;

export const formatDetectionSchema = z.object({
  ecosystem: z.enum(BINARY_ECOSYSTEMS),
  format: z.string().min(1),
  confidence: z.number().min(0).max(1),
  /** Prova del rilevamento: firma di byte osservata (L0 — mai un indizio nascosto). */
  magicEvidence: z.string().min(1),
});
export type FormatDetection = z.infer<typeof formatDetectionSchema>;

export const coverageMatrixSchema = z.object({
  generatedAt: z.string().datetime(),
  rows: z.array(
    z.object({
      ecosystem: z.enum(BINARY_ECOSYSTEMS),
      engineId: z.string(),
      status: z.enum(CAPABILITY_STATUSES),
      reason: z.string().optional(),
      benchmarkRef: z.string().optional(),
    }),
  ),
});
export type CoverageMatrix = z.infer<typeof coverageMatrixSchema>;

export const routingDecisionSchema = z.object({
  detection: formatDetectionSchema,
  engineId: z.string().nullable(),
  /** null = nessun adapter per questo ecosistema: dichiarato, mai silenzioso. */
  status: z.enum(CAPABILITY_STATUSES),
  reason: z.string().optional(),
});
export type RoutingDecision = z.infer<typeof routingDecisionSchema>;
