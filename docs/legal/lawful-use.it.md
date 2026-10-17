# Casi d'uso leciti di REVRA

> **Disclaimer:** questo documento descrive il posizionamento d'uso del prodotto e
> panorami giuridici generali (US/UE). Non è consulenza legale; per casi concreti
> serve un legale nella giurisdizione competente.

## Principio

REVRA è uno strumento di analisi e verifica. Tutti i casi legittimi hanno tre
elementi in comune: **possesso legittimo del binario**, **finalità autorizzata**
(sicurezza, interoperabilità, conformità, ricerca, forense), **nessuna
ridistribuzione del codice decompilato**. La provenance REVRA (ogni tentativo
registrato) è essa stessa un asset legale: dimostra cosa è stato analizzato,
quando, con quale strumento e con quale finalità — chain-of-custody per
forense e audit.

## Casi d'uso leciti

| # | Caso | Base giuridica (US/UE) | Note |
|---|---|---|---|
| 1 | **Malware analysis difensivo** (CERT/SOC/antivirus) | Standard di settore; esenzioni DMCA §1201(j) ricerca sicurezza | Il caso d'uso storicamente sempre ritenuto lecito |
| 2 | **Vulnerability research e coordinated disclosure** | Esenzioni DMCA §1201(j); fair use (US); direttiva NIS2 incoraggia la segnalazione | Con scope authorization (bug bounty: nel perimetro) |
| 3 | **Interoperabilità** (integrazione con software legacy/decessuto, protocolli non documentati) | UE: direttiva 2009/24/EC art. 5(3)+6 (decompilazione per interoperabilità espressamente consentita a condizioni); US: Sega v. Accolade, Oracle v. Google (fair use) | Condizioni UE: necessaria, non divulgare l'output, legittimo possesso |
| 4 | **Forense digitale / incident response** | Indagini autorizzate, legal process | La provenance REVRA serve come documentazione d'indagine |
| 5 | **Defense & intelligence** (analisi di sistemi acquisiti/catturati, firmware) | Programmi governativi — pratica standard | Interne alla committenza autorizzata |
| 6 | **Supply-chain security / audit fornitori** (verificare cosa ha davvero compilato/spedito il vendor; backdoor audit) | Ricerca di sicurezza su prodotto acquisito; obblighi NIS2/CRA di due diligence | La CRA europea (Cyber Resilience Act) rende questi audit requisito, non opzione |
| 7 | **Compliance & classificazione export** (determinare quali funzionalità crittografiche contiene un binario — ITAR/EAR/Wassenaar) | Obbligo di classificazione richiede l'analisi | L'output dell'analisi può essere a sua volta controllato: valutare con legale export |
| 8 | **Debugging/QA del proprio software o licenziato** (crash senza simboli, verifica patch del vendor via diff) | Proprietà o licenza d'uso; analisi non distribuita | Rischio minimo |
| 9 | **Recupero sorgente perso del PROPRI prodotto** (build archaeology, vendor scomparso) | Sei il titolare: zero rischio | Caso d'uso enterprise frequente e sottovalutato |
| 10 | **Ricerca accademica e didattica** | Pratica universalmente accettata | CTF, corsi, paper |
| 11 | **Firmware/IoT di dispositivi posseduti** (sicurezza, safety audit medici/industriali) | DMCA §1201 esenzioni IoT/dispositivi medici; direttiva UE | Possesso del dispositivo richiesto |
| 12 | **Software preservation** (archivi, musei, progetti di conservazione) | DMCA esenzioni preservation per biblioteche/archivi/musei | No ridistribuzione dell'output |
| 13 | **Modding personale non distribuito** di copie possedute | Zona grigia tollerata: possibile violazione EULA (rischio contrattuale: ban), mai distribuire derivati | Non è il segmento target di REVRA |

## Linee rosse (mai)

1. **Bypass di DRM/misure tecnologiche di protezione** (DMCA §1201, InfoSoc art. 6) — salvo esenzione applicabile.
2. **Ridistribuire codice decompilato o derivati** di software altrui — violazione copyright, il rischio più grave.
3. **Crack di licenze / pirateria** — elusione controlli di licenza a fini d'uso non autorizzato.
4. **Analisi su sistemi senza autorizzazione** (CFAA e equivalenti) — l'accesso abusivo non diventa lecito perché l'analisi è difensiva.
5. **Anti-cheat di giochi online** — ban + rischi legali.
6. **Clone commerciale** di prodotto altrui basato sul decompilato — violazione copyright (copia letterale di struttura).

## Condizioni che tengono ogni caso pulito

- Possesso legittimo della copia analizzata.
- Finalità documentata (la provenance REVRA la documenta da sola).
- Nessuna distribuzione dell'output.
- Nessuna elusione di protezioni tecniche.
- EULA letto: dove vieta il RE, valutare se un'esenzione legale prevale (spesso per ricerca sicurezza sì; per comodità no).

## Nota export-control

Gli strumenti di analisi e i loro output possono rientrare nei controlli
Wassenaar/EAR (categoria "intrusion software" e oggetti dual-use). REVRA è uno
strumento di analisi/verifica non sfruttante; i deployment enterprise devono
comunque verificare la classificazione export per il mercato di destinazione.
