/**
* G5.1 — PqcKemService (PRD §3.4, Beyond Limits).
*
* Key Encapsulation Mechanism (KEM) post-quantica basata su ML-KEM-768
* (FIPS 203, ex Kyber-768). A differenza della firma digitale (ML-DSA-65, già
* implementata in SovereignService), il KEM permette lo SCAMBIO DI CHIAVI
* EFFIMERO tra due parti senza canale sicuro preesistente: Alice genera una
* coppia di chiavi effimere, Bob incapsula un segreto condiviso usando la
* public key di Alice, e solo Alice può decapsularlo con la sua secret key.
*
* FORWARD SECRECY QUANTISTICA (gate PRD §3.4): anche se un avversario registra
* tutto il traffico cifrato oggi e ottiene le chiavi private domani (tramite un
* computer quantistico futuro o compromissione HSM), NON potrà decifrare le
* sessioni passate perché ogni sessione usa una coppia di chiavi EFFIMERA che
* viene distrutta dopo l'uso. La sicurezza non dipende dalla longevità delle
* chiavi ma dall'effimericità dello scambio.
*
* ML-KEM-768 vs Kyber-768: sono equivalenti funzionalmente (NIST ha standardizzato
* Kyber come ML-KEM con minime variazioni parametriche). @noble/post-quantum
* espone ml_kem768 che è compatibile FIPS 203. Security level: NIST Level 3
* (~192 bit di sicurezza classica, ~128 bit contro Grover).
*
* Derivazione chiave di sessione: il shared secret prodotto da encaps/decaps
* (32 byte) viene usato direttamente come chiave AES-256-GCM per la sessione.
* In produzione si applicherebbe HKDF-SHA256 per separare chiavi di
* encryption/authentication, ma per il gate G5.1 il raw shared secret è
* sufficiente a dimostrare la forward secrecy quantistica.
*
* Resistenza side-channel: @noble/post-quantum implementa operazioni constant-time
* per ML-KEM (nessun branch data-dependent, nessuna lookup table indexata da
* dati segreti). Questo mitiga attacchi timing/cache-based sul KEM stesso.
* La resistenza side-channel completa richiede anche HSM hardware (PRD §9),
* ma il software layer è già hardened.
*/
import { createHash, randomBytes } from 'node:crypto';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

export interface KemKeyPair {
  /** Public key effimera (da condividere con la controparte). */
  readonly publicKey: Uint8Array;
  /** Secret key effimera (MAI condividere; distruggere dopo decaps). */
  readonly secretKey: Uint8Array;
  /** Timestamp di creazione (per audit trail). */
  readonly createdAt: string;
}

export interface EncapsulatedSecret {
  /** Ciphertext da inviare alla controparte (pubblico). */
  readonly ciphertext: Uint8Array;
  /** Shared secret derivato localmente (segreto, mai trasmettere). */
  readonly sharedSecret: Uint8Array;
}

export interface DecapsulatedSecret {
  /** Shared secret derivato localmente (identico a quello di encaps). */
  readonly sharedSecret: Uint8Array;
  /** true se la decapsulazione è riuscita (ciphertext valido). */
  readonly valid: boolean;
}

export interface SessionKeys {
  /** Chiave di cifratura derivata dal shared secret (AES-256-GCM ready). */
  readonly encryptionKey: Buffer;
  /** Chiave di autenticazione derivata dal shared secret (HMAC-SHA256 ready). */
  readonly authKey: Buffer;
  /** ID univoco della sessione (per tracciabilità audit). */
  readonly sessionId: string;
}

export interface PqcKemOptions {
  /** Funzione per ottenere timestamp corrente (iniettabile per test). */
  now?: () => string;
  /** Generatore di nonce/session ID (iniettabile per test deterministici). */
  nonceGen?: () => string;
}

export class PqcKemService {
  private readonly now: () => string;
  private readonly nonceGen: () => string;

  constructor(options: PqcKemOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.nonceGen = options.nonceGen ?? (() => randomBytes(16).toString('hex'));
  }

  /**
   * Genera una coppia di chiavi KEM EFFIMERA per una nuova sessione.
   * Le chiavi sono ML-KEM-768 (FIPS 203, NIST Level 3).
   *
   * La secret key DEVE essere distrutta dopo la decapsulazione (forward secrecy).
   * In produzione: conservare solo in RAM volatile, mai su disco/HSM persistente.
   */
  generateEphemeralKeyPair(): KemKeyPair {
    const { publicKey, secretKey } = ml_kem768.keygen();
    return {
      publicKey: new Uint8Array(publicKey),
      secretKey: new Uint8Array(secretKey),
      createdAt: this.now(),
    };
  }

  /**
   * Incapsula un segreto condiviso usando la public key effimera della controparte.
   * Ritorna il ciphertext (da inviare) e il shared secret locale (segreto).
   *
   * Solo la controparte con la corrispondente secret key può decapsulare.
   * Il shared secret è identico a quello che la controparte otterrà con decapsulate().
   */
  encapsulate(peerPublicKey: Uint8Array): EncapsulatedSecret {
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(peerPublicKey);
    return {
      ciphertext: new Uint8Array(cipherText),
      sharedSecret: new Uint8Array(sharedSecret),
    };
  }

  /**
   * Decapsula il ciphertext ricevuto usando la propria secret key effimera.
   * Ritorna il shared secret (identico a quello di encapsulate) e validità.
   *
   * Se valid=false, il ciphertext è corrotto/tampered: NON usare il shared secret.
   * Dopo questa chiamata, la secret key DOVREBBE essere distrutta (forward secrecy).
   */
  decapsulate(ciphertext: Uint8Array, secretKey: Uint8Array): DecapsulatedSecret {
    try {
      const sharedSecret = ml_kem768.decapsulate(ciphertext, secretKey);
      return {
        sharedSecret: new Uint8Array(sharedSecret),
        valid: true,
      };
    } catch {
      // Ciphertext invalido/tampered: shared secret sarebbe garbage.
      return {
        sharedSecret: new Uint8Array(32), // placeholder sicuro (mai usare)
        valid: false,
      };
    }
  }

  /**
   * Deriva chiavi di sessione dal shared secret KEM.
   * Applica SHA-256 al shared secret per separare encryption/auth keys
   * (versione semplificata di HKDF: domain separation via prefix).
   *
   * In produzione: usare HKDF-SHA256 con salt/info appropriati.
   * Qui SHA-256 è sufficiente per il gate G5.1 (dimostrazione forward secrecy).
   */
  deriveSessionKeys(sharedSecret: Uint8Array): SessionKeys {
    const encKey = createHash('sha256')
      .update(Buffer.concat([Buffer.from('enc:'), Buffer.from(sharedSecret)]))
      .digest();
    const authKey = createHash('sha256')
      .update(Buffer.concat([Buffer.from('auth:'), Buffer.from(sharedSecret)]))
      .digest();
    return {
      encryptionKey: encKey,
      authKey: authKey,
      sessionId: `kem-session-${this.nonceGen()}`,
    };
  }

  /**
   * Distrugge una secret key effimera (zero-fill + GC hint).
   * Chiamare DOPO decapsulate() per garantire forward secrecy.
   * In produzione: usare buffer allocati in memoria non-swappable (mlock).
   */
  destroySecretKey(secretKey: Uint8Array): void {
    // Zero-fill: previene recupero da dump di memoria.
    for (let i = 0; i < secretKey.length; i++) {
      secretKey[i] = 0;
    }
    // Hint GC: rimuove riferimento immediato.
    // Nota: JS non garantisce deallocation immediata, ma zero-fill è sufficiente
    // per mitigare recovery da heap dump.
  }

  /**
   * Verifica che una public key sia valida (lunghezza corretta ML-KEM-768).
   * Previene attacchi con chiavi malformate che potrebbero causare crash/leak.
   */
  isValidPublicKey(publicKey: Uint8Array): boolean {
    // ML-KEM-768 public key size: 1184 bytes (FIPS 203 Table 2).
    return publicKey.length === 1184;
  }

  /**
   * Verifica che un ciphertext sia valido (lunghezza corretta ML-KEM-768).
   * Previene attacchi con ciphertext malformati.
   */
  isValidCiphertext(ciphertext: Uint8Array): boolean {
    // ML-KEM-768 ciphertext size: 1088 bytes (FIPS 203 Table 2).
    return ciphertext.length === 1088;
  }

  /**
   * Metriche di sicurezza per audit: dimensione chiave, security level, algoritmo.
   * Usato nei report compliance e nell'UI per trasparenza (PRD §0.2).
   */
  securityMetrics(): {
    algorithm: string;
    standard: string;
    securityLevel: number;
    publicKeySize: number;
    secretKeySize: number;
    ciphertextSize: number;
    sharedSecretSize: number;
    sideChannelResistance: string;
  } {
    return {
      algorithm: 'ML-KEM-768',
      standard: 'FIPS 203 (ex Kyber-768)',
      securityLevel: 3, // NIST Level 3: ~192 bit classical, ~128 bit quantum
      publicKeySize: 1184,
      secretKeySize: 2400,
      ciphertextSize: 1088,
      sharedSecretSize: 32,
      sideChannelResistance: 'constant-time (@noble/post-quantum v0.7)',
    };
  }
}