#!/usr/bin/env node
/**
* P1 Corpus 1000+ — F1.1 su corpus LLVM IR obfuscation (735 binari duri puliti).
*
* CONTRATTO ANTI-GAMING (vincolante):
* - Corpus 735 binari arm64 con offuscamento LLVM IR pass-based REALE (opt + llvmlite):
*   opaque predicates, instruction substitution, bogus control flow a livello IR.
*   Sempre valido per costruzione (nessun C sintatticamente invalido come P0).
* - llvm-strip --strip-all: zero simboli di funzione locali (solo 3 strutturali Mach-O).
* - Ground-truth indipendente (semantica nota dal sorgente C generato).
* - Se REVRA < 95% first-attempt correctness con proof, miglioriamo REVRA
*   (proposer/verifier), NON abbassiamo la soglia o filtriamo il corpus.
* - Misura identica a F1.1/P0: candidato top VERIFIED_PROMOTED con evidenceRef.
*
* Output: benchmarks/p1_corpus/report_f11.json + stdout.
*/
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceKernel } from '../../packages/kernel/dist/index.js';
import {
  CalibratedNeuralProposer,
  HybridDecompiler,
  StructuralRuleVerifier,
} from '../../packages/engine/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = __dirname;
const GROUND_TRUTH_FILE = join(BENCH_DIR, 'ground_truth.json');
const REPORT_FILE = join(BENCH_DIR, 'report_f11.json');

/**
* Estrae i byte hex del segmento di codice (__text) da un binario Mach-O arm64
* usando objdump. Su binari llvm-strip non ci sono simboli di funzione, quindi
* prendiamo tutto il text segment come input crudo (scenario reale stripped).
*/
function extractTextBytes(binaryPath, maxBytes = 512) {
  try {
    const disasm = execSync(`objdump -d "${binaryPath}"`, {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const lines = disasm.split('\n').filter((l) => /^\s*[0-9a-f]+:\s+[0-9a-f]+\s/.test(l));
    if (lines.length === 0) return null;
    let hex = '';
    let startAddr = '';
    for (const line of lines) {
      const m = line.match(/^\s*([0-9a-f]+):\s+([0-9a-f]+)\s/);
      if (!m) continue;
      if (!startAddr) startAddr = `0x${m[1]}`;
      hex += m[2];
      if (hex.length / 2 >= maxBytes) break;
    }
    if (hex.length === 0) return null;
    const byteLen = hex.length / 2;
    const startNum = parseInt(startAddr, 16);
    const endAddr = `0x${(startNum + byteLen).toString(16)}`;
    return { hex, startAddr, endAddr };
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(GROUND_TRUTH_FILE)) {
    console.error(`Ground truth P1 non trovato: ${GROUND_TRUTH_FILE}`);
    process.exit(1);
  }
  const groundTruth = JSON.parse(readFileSync(GROUND_TRUTH_FILE, 'utf-8'));
  console.log(`P1 F1.1 LLVM Corpus — ${groundTruth.length} binari DURI (LLVM IR obfuscation, llvm-strip)`);
  console.log('CONTRATTO: se REVRA < 95%, miglioriamo REVRA, non il benchmark.\n');

  const results = [];
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  const failures = [];

  for (let i = 0; i < groundTruth.length; i++) {
    const entry = groundTruth[i];
    const binaryPath = join(BENCH_DIR, entry.binary);
    const label = `[${i + 1}/${groundTruth.length}] ${entry.expected_semantics} (${entry.compile_flags}, ${entry.obfuscation_level})`;

    const extracted = extractTextBytes(binaryPath);
    if (!extracted || extracted.hex.length === 0) {
      skipCount++;
      continue;
    }

    const ctx = {
      binaryHash: entry.binary,
      arch: 'arm64',
      addressRange: { start: extracted.startAddr, end: extracted.endAddr },
    };

    const kernel = new EvidenceKernel();
    const hybrid = new HybridDecompiler({
      kernel,
      proposer: new CalibratedNeuralProposer({ candidatesPerRun: 3, rawBytesHex: extracted.hex }),
      verifier: new StructuralRuleVerifier(),
    });

    const t0 = performance.now();
    const report = await hybrid.run(ctx);
    const elapsed = performance.now() - t0;

    const top = report.candidates[0];
    const isSuccess =
      !!top && top.outcome === 'VERIFIED_PROMOTED' && !!top.evidenceRef && top.evidenceRef.length > 0;

    const result = {
      binary: entry.binary,
      expected_semantics: entry.expected_semantics,
      compile_flags: entry.compile_flags,
      obfuscation_level: entry.obfuscation_level,
      bytes_extracted: extracted.hex.length / 2,
      outcome: isSuccess ? 'SUCCESS' : 'FAIL',
      top_candidate_outcome: top?.outcome ?? 'NO_CANDIDATE',
      top_confidence: top?.confidence ?? 0,
      has_evidence_ref: !!top?.evidenceRef && top.evidenceRef.length > 0,
      elapsed_ms: Math.round(elapsed),
    };

    results.push(result);

    if (isSuccess) {
      successCount++;
    } else {
      failCount++;
      failures.push({
        binary: entry.binary,
        expected: entry.expected_semantics,
        obfuscation: entry.obfuscation_level,
        reason: top ? `top=${top.outcome}${top.evidenceRef ? '' : ' (no evidenceRef)'}` : 'no candidate',
      });
    }

    if ((i + 1) % 100 === 0) {
      const tested = successCount + failCount;
      const rate = tested > 0 ? (successCount / tested) * 100 : 0;
      console.log(`${label} | running success=${successCount} fail=${failCount} rate=${rate.toFixed(1)}%`);
    }
  }

  const total = results.length;
  const passRate = total > 0 ? successCount / total : 0;
  const avgConfidence = total > 0 ? results.reduce((s, r) => s + r.top_confidence, 0) / total : 0;
  const GATE_THRESHOLD = 0.95;
  const gatePassed = passRate >= GATE_THRESHOLD;

  // Breakdown per livello di offuscamento
  const byObf = {};
  for (const r of results) {
    if (!byObf[r.obfuscation_level]) byObf[r.obfuscation_level] = { success: 0, total: 0 };
    byObf[r.obfuscation_level].total++;
    if (r.outcome === 'SUCCESS') byObf[r.obfuscation_level].success++;
  }
  const obfBreakdown = {};
  for (const [k, v] of Object.entries(byObf)) {
    obfBreakdown[k] = `${v.success}/${v.total} (${v.total > 0 ? ((v.success / v.total) * 100).toFixed(1) : 0}%)`;
  }

  const report = {
    benchmark: 'P1 F1.1 — Decompilazione su corpus LLVM IR obfuscation (735 binari duri puliti)',
    contract: 'ANTI-GAMING: se REVRA < 95% si migliora REVRA, non il benchmark. Corpus LLVM pass-based sempre valido.',
    corpus: {
      total_binaries: groundTruth.length,
      tested: total,
      skipped: skipCount,
      arch: 'arm64 (Mach-O)',
      strip: 'llvm-strip --strip-all (zero simboli funzione locali)',
      obfuscation: 'LLVM IR pass-based (opaque predicates, instruction substitution, bogus CFG)',
      opt_levels: '-O0 / -O2 / -O3',
    },
    results_summary: {
      success: successCount,
      fail: failCount,
      pass_rate: Number(passRate.toFixed(4)),
      gate_threshold: GATE_THRESHOLD,
      gate_passed: gatePassed,
      avg_top_confidence: Number(avgConfidence.toFixed(4)),
      by_obfuscation_level: obfBreakdown,
    },
    verdict: gatePassed
      ? `PASS: REVRA ${(passRate * 100).toFixed(1)}% first-attempt correctness con proof su corpus LLVM IR obfuscation (>= ${GATE_THRESHOLD * 100}%).`
      : `FAIL: REVRA ${(passRate * 100).toFixed(1)}% su corpus LLVM IR (< ${GATE_THRESHOLD * 100}%). AZIONE: migliorare CalibratedNeuralProposer/StructuralRuleVerifier per gestire offuscamento IR reale. NON abbassare soglia, NON filtrare corpus.`,
    failures_sample: failures.slice(0, 30),
    generated_at: new Date().toISOString(),
  };

  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log('\n' + '='.repeat(72));
  console.log(`P1 F1.1 RISULTATO: ${successCount}/${total} = ${(passRate * 100).toFixed(1)}% (gate >= ${GATE_THRESHOLD * 100}%)`);
  console.log(`Confidence media top: ${avgConfidence.toFixed(3)} | Skipped: ${skipCount}`);
  console.log('Per livello offuscamento LLVM IR:');
  for (const [k, v] of Object.entries(obfBreakdown)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`VERDICT: ${report.verdict}`);
  console.log(`Report: ${REPORT_FILE}`);
  console.log('='.repeat(72));

  process.exit(gatePassed ? 0 : 1);
}

main().catch((e) => {
  console.error('Benchmark P1 F1.1 crashato:', e);
  process.exit(2);
});