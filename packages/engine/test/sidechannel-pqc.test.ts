/**
 * A4 — Side-channel resistance check su PQC (ML-DSA-65 / Dilithium).
 *
 * Metodologia corretta: il rischio side-channel timing è la dipendenza del
 * tempo dal CONTENUTO SEGRETO (la chiave) o dal contenuto del messaggio in
 * modo che un attaccante possa inferire bit segreti. NON è una dipendenza
 * dalla LUNGHEZZA PUBBLICA del messaggio (processare più byte pubblici costa
 * di più per costruzione, e la lunghezza è nota all'attaccante — non è un
 * leak).
 *
 * Quindi misuriamo, a dimensione di input FISSA, se il tempo di sign/verify
 * correla col CONTENUTO del messaggio (valore dei byte). Gate A4: nessuna
 * correlazione significativa (|Pearson| < 0.5) tra un proxy del contenuto
 * (hamming weight / somma byte) e il tempo → nessun leak timing sul contenuto.
 *
 * Questo è un check statistico di primo livello, non una prova formale di
 * constant-time (che richiederebbe analisi a livello istruzione / ctgrind).
 * Mitiga il rischio PRD §10 "side-channel HSM" come gate A4 misurabile.
 */
import { describe, expect, it } from 'vitest';
import { SovereignService } from '../src/sovereign/sovereign-service.js';

function measure(fn: () => void, samples: number): number[] {
  const times: number[] = [];
  // Warmup JIT.
  for (let i = 0; i < 8; i++) fn();
  for (let i = 0; i < samples; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6); // ms
  }
  return times;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

// Proxy del "contenuto" del messaggio: hamming weight (numero di bit 1).
// Se il tempo correlasse con questo, ci sarebbe un leak timing sul contenuto.
function hammingWeight(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    while (c > 0) {
      w += c & 1;
      c >>= 1;
    }
  }
  return w;
}

// Genera N messaggi della STESSA lunghezza ma contenuto diverso (hamming weight variabile).
function fixedLengthMessages(len: number, count: number): string[] {
  const msgs: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    for (let j = 0; j < len; j++) {
      // Caratteri con hamming weight variabile ma lunghezza fissa.
      s += String.fromCharCode(33 + ((i * 7 + j * 13) % 94));
    }
    msgs.push(s);
  }
  return msgs;
}

describe('A4 — Side-channel PQC (ML-DSA-65) timing check', () => {
  it('sign: a lunghezza fissa, nessuna correlazione tra contenuto (hamming weight) e tempo', { timeout: 30_000 }, () => {
    const svc = new SovereignService();
    const tenantId = 'sidechannel-sign-content';
    svc.provisionTenantKey(tenantId, new Date().toISOString());
    const LEN = 256; // lunghezza fissa
    const msgs = fixedLengthMessages(LEN, 25);
    const samplesPerMsg = 12;
    const weights: number[] = [];
    const avgTimes: number[] = [];
    for (const m of msgs) {
      weights.push(hammingWeight(m));
      const times = measure(() => svc.signForTenant(tenantId, m), samplesPerMsg);
      avgTimes.push(mean(times));
    }
    const correlation = pearson(weights, avgTimes);
    // Gate A4: |correlazione| < 0.5 → nessun leak timing lineare sul contenuto.
    expect(Math.abs(correlation)).toBeLessThan(0.5);
  });

  it('verify: a lunghezza fissa, nessuna correlazione tra contenuto e tempo', { timeout: 30_000 }, () => {
    const svc = new SovereignService();
    const tenantId = 'sidechannel-verify-content';
    svc.provisionTenantKey(tenantId, new Date().toISOString());
    const LEN = 256;
    const msgs = fixedLengthMessages(LEN, 25);
    const samplesPerMsg = 6;
    const weights: number[] = [];
    const avgTimes: number[] = [];
    for (const m of msgs) {
      const { signature } = svc.signForTenant(tenantId, m);
      weights.push(hammingWeight(m));
      const times = measure(
        () => svc.verifyTenantSignature(tenantId, m, signature),
        samplesPerMsg,
      );
      avgTimes.push(mean(times));
    }
    const correlation = pearson(weights, avgTimes);
    expect(Math.abs(correlation)).toBeLessThan(0.5);
  });

  it('varianza timing tra messaggi diversi (stessa lunghezza) è entro rumore: ratio p95/mediana < 3', { timeout: 30_000 }, () => {
    // Sanity aggiuntiva: nessun outlier estremo che suggerisca branch secret-dependent.
    const svc = new SovereignService();
    const tenantId = 'sidechannel-variance';
    svc.provisionTenantKey(tenantId, new Date().toISOString());
    const LEN = 256;
    const msgs = fixedLengthMessages(LEN, 20);
    const medians: number[] = [];
    for (const m of msgs) {
      const times = measure(() => svc.signForTenant(tenantId, m), 10).sort((a, b) => a - b);
      medians.push(times[Math.floor(times.length / 2)]!);
    }
    medians.sort((a, b) => a - b);
    const median = medians[Math.floor(medians.length / 2)]!;
    const p95 = medians[Math.floor(medians.length * 0.95)]!;
    // Ratio ragionevole: nessun messaggio è >3x la mediana (outlier secret-dependent).
    expect(p95 / median).toBeLessThan(3);
  });
});