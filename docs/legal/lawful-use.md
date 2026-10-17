# Lawful use of REVRA

> **Disclaimer:** this document describes the intended use of the product and general
> legal landscapes (US/EU). It is not legal advice; consult a lawyer in your
> jurisdiction for concrete cases.

## Principle

REVRA is an analysis and verification tool. Every legitimate use shares three
elements: **lawful possession of the binary**, an **authorized purpose** (security,
interoperability, compliance, research, forensics), and **no redistribution of the
decompiled code**. REVRA's provenance (every attempt logged) is itself a legal
asset: it documents what was analyzed, when, with which tool and purpose — a
chain of custody for forensics and audits.

## Lawful use cases

| # | Use case | Legal basis (US/EU) | Notes |
|---|---|---|---|
| 1 | **Defensive malware analysis** (CERT/SOC/AV) | Industry standard; DMCA §1201(j) security research exemptions | The historically uncontroversial case |
| 2 | **Vulnerability research & coordinated disclosure** | DMCA §1201(j); fair use (US); NIS2 encourages reporting | With scope authorization (bug bounty: within scope) |
| 3 | **Interoperability** (legacy integration, undocumented protocols) | EU: dir. 2009/24/EC art. 5(3)+6 (decompilation for interoperability expressly permitted, under conditions); US: *Sega v. Accolade*, *Oracle v. Google* (fair use) | EU conditions: necessary, no disclosure of output, lawful possession |
| 4 | **Digital forensics / incident response** | Authorized investigations, legal process | REVRA provenance doubles as investigation documentation |
| 5 | **Defense & intelligence** (acquired/captured systems, firmware) | Government programs — standard practice | Within the authorized commissioning entity |
| 6 | **Supply-chain security / vendor audits** (what did the vendor actually ship; backdoor audits) | Security research on acquired products; NIS2/CRA due-diligence obligations | The EU Cyber Resilience Act makes these audits a requirement |
| 7 | **Compliance & export classification** (which cryptographic functionality a binary contains — ITAR/EAR/Wassenaar) | Classification obligations require the analysis | Analysis output may itself be export-controlled: assess with counsel |
| 8 | **Debugging/QA of your own or licensed software** (symbol-less crashes, vendor patch diffing) | Ownership or license; unpublished analysis | Minimal risk |
| 9 | **Source recovery for your OWN product** (lost source, defunct vendor) | You are the titleholder: zero risk | Frequent, underrated enterprise case |
| 10 | **Academic research & teaching** | Universally accepted | CTFs, courses, papers |
| 11 | **Firmware/IoT you own** (security, medical/industrial safety audits) | DMCA §1201 IoT/medical exemptions; EU directives | Ownership of the device required |
| 12 | **Software preservation** (archives, museums, conservation projects) | DMCA preservation exemptions for libraries/archives/museums | No redistribution of output |
| 13 | **Personal, non-distributed modding** of owned copies | Gray area, generally tolerated: possible EULA breach (contract risk: bans); never distribute derivatives | Not a REVRA target segment |

## Red lines (never)

1. **Circumventing DRM / technical protection measures** (DMCA §1201, InfoSoc art. 6) — unless an exemption applies.
2. **Redistributing decompiled code or derivatives** of someone else's software — copyright infringement; the most serious risk.
3. **License cracking / piracy.**
4. **Analyzing systems without authorization** (CFAA and equivalents) — abusive access does not become lawful because the analysis is "defensive".
5. **Online-game anti-cheat tampering.**
6. **Commercial clones** built from decompiled output — copyright infringement (literal-structure copying).

## Conditions that keep every case clean

- Lawful possession of the analyzed copy.
- Documented purpose (REVRA provenance documents it by itself).
- No distribution of output.
- No circumvention of technical protections.
- Read the EULA: where it forbids RE, assess whether a legal exemption prevails
  (often yes for security research; rarely for convenience).

## Export-control note

Analysis tools and their outputs can fall under Wassenaar/EAR controls
("intrusion software" and dual-use items). REVRA is a non-exploiting
analysis/verification tool; enterprise deployments should still verify export
classification for the destination market.
