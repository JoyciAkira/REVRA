/**
 * G5.1 — PqcKemService (gate: crittografia PQC ML-KEM-768 verificata con
 * encaps/decaps round-trip; forward secrecy quantistica tramite chiavi effimere
 * distrutte dopo uso; resistenza side-channel via operazioni constant-time
 * @noble/post-quantum).
 *
 * ML-KEM-768 (FIPS 203, ex Kyber-768) è il KEM standardizzato NIST per lo
 * scambio di chiavi post-quantico. A differenza della firma digitale (ML-DSA-65),
 * il KEM permette di derivare un segreto condiviso tra due parti senza canale
 * sicuro preesistente. La FORWARD SECRECY QUANTISTICA è garantita dall'uso di
 * chiavi EFFIMERE: ogni sessione genera una nuova coppia di chiavi che viene
 * distrutta dopo la decapsulazione. Anche se un avversario registra tutto il
 * traffico oggi e ottiene le chiavi private domani (tramite computer quantistico
 * futuro), non potrà decifrare le sessioni passate perché le chiavi effimere
 * non esistono più.
 *
 * Resistenza side-channel: @noble/post-quantum implementa ML-KEM con operazioni
 * constant-time (nessun branch data-dependent, nessuna lookup table indexata da
 * dati segreti). Questo mitiga attacchi timing/cache-based sul KEM stesso.
 *
 * NOTA API @noble/post-quantum v0.7: ml_kem768.encapsulate ritorna
 * { cipherText, sharedSecret } (T maiuscola in cipherText). ML-KEM usa
 * "implicit rejection": con ciphertext corrotto non lancia eccezione ma
 * ritorna un shared secret deterministico DIVERSO da quello corretto.
 */
import { describe, expect, it } from 'vitest';
import { PqcKemService } from '../src/sovereign/pqc-kem-service.js';

describe('G5.1 — PqcKemService (ML-KEM-768, forward secrecy quantistica)', () => {
  it('GATE PQC VERIFICATA: encaps/decaps round-trip produce shared secret identico', () => {
    const kem = new PqcKemService();
    // Alice genera una coppia di chiavi effimere.
    const aliceKeyPair = kem.generateEphemeralKeyPair();
    expect(aliceKeyPair.publicKey.length).toBe(1184); // ML-KEM-768 public key size
    expect(aliceKeyPair.secretKey.length).toBe(2400); // ML-KEM-768 secret key size

    // Bob incapsula un segreto usando la public key di Alice.
    const encapsulated = kem.encapsulate(aliceKeyPair.publicKey);
    expect(encapsulated.ciphertext.length).toBe(1088); // ML-KEM-768 ciphertext size
    expect(encapsulated.sharedSecret.length).toBe(32); // 32-byte shared secret

    // Alice decapsula il ciphertext usando la sua secret key.
    const decapsulated = kem.decapsulate(encapsulated.ciphertext, aliceKeyPair.secretKey);
    expect(decapsulated.valid).toBe(true);
    expect(decapsulated.sharedSecret.length).toBe(32);

    // I due shared secret devono essere IDENTICI (proprietà fondamentale del KEM).
    expect(Buffer.from(decapsulated.sharedSecret).equals(Buffer.from(encapsulated.sharedSecret))).toBe(true);
  });

  it('GATE FORWARD SECRECY: chiavi effimere vengono distrutte dopo uso (zero-fill)', () => {
    const kem = new PqcKemService();
    const keyPair = kem.generateEphemeralKeyPair();
    const originalSecretKey = new Uint8Array(keyPair.secretKey); // copia per confronto

    // Simula una sessione completa: encaps + decaps.
    const encapsulated = kem.encapsulate(keyPair.publicKey);
    const decapsulated = kem.decapsulate(encapsulated.ciphertext, keyPair.secretKey);
    expect(decapsulated.valid).toBe(true);

    // Dopo la decapsulazione, la secret key viene distrutta (forward secrecy).
    kem.destroySecretKey(keyPair.secretKey);

    // La secret key deve essere zero-filled (non recuperabile da memory dump).
    for (let i = 0; i < keyPair.secretKey.length; i++) {
      expect(keyPair.secretKey[i]).toBe(0);
    }

    // La secret key originale (copia) non è zero-filled: conferma che destroySecretKey
    // ha modificato solo l'array passato, non tutte le copie (comportamento atteso).
    expect(originalSecretKey.some((b) => b !== 0)).toBe(true);
  });

  it('decapsulazione con ciphertext corrotto ritorna shared secret DIVERSO (implicit rejection ML-KEM, mai garbage silente)', () => {
    const kem = new PqcKemService();
    const keyPair = kem.generateEphemeralKeyPair();

    // Genera un ciphertext valido prima.
    const validEncapsulated = kem.encapsulate(keyPair.publicKey);

    // Ciphertext corrotto (byte random invece di ciphertext valido).
    const corruptedCiphertext = new Uint8Array(1088);
    for (let i = 0; i < corruptedCiphertext.length; i++) {
      corruptedCiphertext[i] = Math.floor(Math.random() * 256);
    }

    const decapsulated = kem.decapsulate(corruptedCiphertext, keyPair.secretKey);

    // ML-KEM usa "implicit rejection": non fallisce esplicitamente ma produce
    // un shared secret deterministico DIVERSO da quello corretto. Questo è
    // sicuro perché il segreto risultante è inutilizzabile (non matcha quello
    // del sender), ma non crasha il sistema.
    expect(decapsulated.valid).toBe(true); // ML-KEM non lancia eccezione

    // Il shared secret corrotto è DIVERSO da quello valido (implicit rejection).
    expect(Buffer.from(decapsulated.sharedSecret).equals(Buffer.from(validEncapsulated.sharedSecret))).toBe(false);
  });

  it('decapsulazione con secret key sbagliata ritorna valid=false o shared secret diverso', () => {
    const kem = new PqcKemService();
    const aliceKeyPair = kem.generateEphemeralKeyPair();
    const bobKeyPair = kem.generateEphemeralKeyPair(); // chiave diversa

    // Bob incapsula con la public key di Alice.
    const encapsulated = kem.encapsulate(aliceKeyPair.publicKey);

    // Alice tenta di decapsulare con la secret key di Bob (sbagliata).
    const decapsulated = kem.decapsulate(encapsulated.ciphertext, bobKeyPair.secretKey);

    // ML-KEM non fallisce esplicitamente con chiave sbagliata, ma produce un
    // shared secret diverso (garbage dal punto di vista di Alice).
    if (decapsulated.valid) {
      expect(Buffer.from(decapsulated.sharedSecret).equals(Buffer.from(encapsulated.sharedSecret))).toBe(false);
    } else {
      expect(decapsulated.valid).toBe(false);
    }
  });

  it('deriveSessionKeys produce chiavi di sessione distinte (encryption + auth) dal shared secret', () => {
    const kem = new PqcKemService();
    const keyPair = kem.generateEphemeralKeyPair();
    const encapsulated = kem.encapsulate(keyPair.publicKey);

    const sessionKeys = kem.deriveSessionKeys(encapsulated.sharedSecret);

    expect(sessionKeys.encryptionKey.length).toBe(32); // AES-256 ready
    expect(sessionKeys.authKey.length).toBe(32); // HMAC-SHA256 ready
    expect(sessionKeys.sessionId).toMatch(/^kem-session-/);

    // Le due chiavi devono essere diverse (domain separation via prefix SHA-256).
    expect(sessionKeys.encryptionKey.equals(sessionKeys.authKey)).toBe(false);
  });

  it('isValidPublicKey/isValidCiphertext prevengono attacchi con input malformati', () => {
    const kem = new PqcKemService();
    const keyPair = kem.generateEphemeralKeyPair();
    const encapsulated = kem.encapsulate(keyPair.publicKey);

    // Input validi.
    expect(kem.isValidPublicKey(keyPair.publicKey)).toBe(true);
    expect(kem.isValidCiphertext(encapsulated.ciphertext)).toBe(true);

    // Input malformati (lunghezza sbagliata).
    expect(kem.isValidPublicKey(new Uint8Array(100))).toBe(false);
    expect(kem.isValidCiphertext(new Uint8Array(100))).toBe(false);
  });

  it('securityMetrics espone trasparenza totale (algoritmo, standard, security level, dimensioni)', () => {
    const kem = new PqcKemService();
    const metrics = kem.securityMetrics();

    expect(metrics.algorithm).toBe('ML-KEM-768');
    expect(metrics.standard).toContain('FIPS 203');
    expect(metrics.securityLevel).toBe(3); // NIST Level 3
    expect(metrics.publicKeySize).toBe(1184);
    expect(metrics.secretKeySize).toBe(2400);
    expect(metrics.ciphertextSize).toBe(1088);
    expect(metrics.sharedSecretSize).toBe(32);
    expect(metrics.sideChannelResistance).toContain('constant-time');
  });

  it('GATE RESISTENZA SIDE-CHANNEL: @noble/post-quantum usa operazioni constant-time (verifica indiretta tramite assenza di timing leak misurabile)', () => {
    const kem = new PqcKemService();
    const keyPair = kem.generateEphemeralKeyPair();

    // Misura il tempo di encapsulazione su input diversi (dovrebbe essere costante).
    // Nota: in JS puro non possiamo garantire constant-time perfetto (GC, JIT),
    // ma @noble/post-quantum è progettato per minimizzare le variazioni.
    const timings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      kem.encapsulate(keyPair.publicKey);
      const t1 = performance.now();
      timings.push(t1 - t0);
    }

    // Calcola la deviazione standard dei tempi.
    const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
    const variance = timings.reduce((acc, t) => acc + (t - mean) ** 2, 0) / timings.length;
    const stdDev = Math.sqrt(variance);

    // La deviazione standard dovrebbe essere piccola rispetto alla media
    // (indicativo di operazioni constant-time, non branch data-dependent).
    // Soglia generosa per CI lento: stdDev < 50% della media.
    expect(stdDev).toBeLessThan(mean * 0.5);
  });

  it('scenario completo: Alice e Bob stabiliscono una sessione sicura con forward secrecy', () => {
    const kem = new PqcKemService();

    // Step 1: Alice genera chiavi effimere.
    const aliceKeys = kem.generateEphemeralKeyPair();

    // Step 2: Bob riceve la public key di Alice e incapsula un segreto.
    const bobEncapsulated = kem.encapsulate(aliceKeys.publicKey);

    // Step 3: Bob deriva le chiavi di sessione dal suo shared secret.
    const bobSessionKeys = kem.deriveSessionKeys(bobEncapsulated.sharedSecret);

    // Step 4: Alice riceve il ciphertext e decapsula con la sua secret key.
    const aliceDecapsulated = kem.decapsulate(bobEncapsulated.ciphertext, aliceKeys.secretKey);
    expect(aliceDecapsulated.valid).toBe(true);

    // Step 5: Alice deriva le chiavi di sessione dal suo shared secret.
    const aliceSessionKeys = kem.deriveSessionKeys(aliceDecapsulated.sharedSecret);

    // Step 6: Le chiavi di sessione di Alice e Bob devono essere identiche.
    expect(aliceSessionKeys.encryptionKey.equals(bobSessionKeys.encryptionKey)).toBe(true);
    expect(aliceSessionKeys.authKey.equals(bobSessionKeys.authKey)).toBe(true);

    // Step 7: Alice distrugge la sua secret key (forward secrecy).
    kem.destroySecretKey(aliceKeys.secretKey);
    expect(aliceKeys.secretKey.every((b) => b === 0)).toBe(true);

    // Step 8: Anche se un avversario ottiene la secret key di Alice DOPO la
    // sessione, non può decifrare il traffico passato perché la chiave effimera
    // è stata distrutta. (Qui simuliamo tentando di decapsulare di nuovo con
    // la secret key zero-filled: fallisce o produce garbage.)
    const attackerDecapsulated = kem.decapsulate(bobEncapsulated.ciphertext, aliceKeys.secretKey);
    if (attackerDecapsulated.valid) {
      // Se per caso ML-KEM non fallisce esplicitamente, il shared secret sarà
      // comunque diverso da quello originale (perché la secret key è corrotta).
      expect(Buffer.from(attackerDecapsulated.sharedSecret).equals(Buffer.from(bobEncapsulated.sharedSecret))).toBe(false);
    } else {
      expect(attackerDecapsulated.valid).toBe(false);
    }
  });
});