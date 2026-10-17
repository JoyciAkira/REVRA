#!/usr/bin/env python3
"""Triton symbolic execution harness (A1++.4 — AtomicSymbolicVerifier).

Legge JSON su stdin: {"codeHex": "...", "baseAddr": 4198400}
Esegue symbolic execution per-istruzione con Triton (Apache-2.0): ogni
istruzione x86-64 viene tradotta in un'espressione SMT bitvector. Ritorna
JSON con lo stato simbolico finale dei registri + le espressioni per-istruzione.

Questo è il cuore della verifica L2 simbolica atomica: invece di emulare
black-box e osservare solo EAX finale (Unicorn), Triton produce l'albero
simbolico esatto di come ogni atomo istruzionale trasforma lo stato.

Se Triton non è installato, lo script esce con codice 2 e messaggio chiaro
(il verifier TS traduce in VERIFIER_UNAVAILABLE, mai silente).

Licenza: Apache-2.0 (Triton — JonathanSalwan/Triton).
"""
import json
import sys

try:
    from triton import TritonContext, ARCH, Instruction, REG
except ImportError:
    # Triton non installato: exit code 2 = unavailable (distinto da errore runtime).
    print(json.dumps({"ok": False, "unavailable": True,
                      "reason": "triton non installato (pip install triton)"}))
    sys.exit(2)


def main() -> None:
    data = json.load(sys.stdin)
    code = bytes.fromhex(data["codeHex"])
    base = int(data.get("baseAddr", 0x401000))

    ctx = TritonContext(ARCH.X86_64)
    # Inizializza i registri a valori simbolici concreti zero (stato pulito).
    for reg in (REG.RAX, REG.RBX, REG.RCX, REG.RDX, REG.RSP, REG.RBP,
                REG.RSI, REG.RDI, REG.RIP, REG.EFLAGS):
        ctx.setConcreteRegisterValue(reg, 0)

    per_instruction = []
    addr = base
    offset = 0
    executed = 0
    while offset < len(code):
        # Decodifica un'istruzione alla volta dall'offset corrente.
        remaining = code[offset:]
        instr = Instruction(addr, remaining[:15])  # max 15 byte x86-64
        try:
            ctx.processing(instr)
        except Exception as exc:
            # Istruzione non supportata da Triton: terminazione onesta.
            print(json.dumps({
                "ok": True, "executed": executed, "partial": True,
                "reason": f"istruzione a {hex(addr)} non supportata: {str(exc)[:120]}",
                "perInstruction": per_instruction,
                "rax": ctx.getConcreteRegisterValue(REG.RAX),
            }))
            return
        executed += 1
        # Registra l'espressione simbolica di RAX dopo questa istruzione.
        rax_expr = ctx.getSymbolicRegister(REG.RAX)
        rax_ast = str(rax_expr.getAst()) if rax_expr is not None else None
        per_instruction.append({
            "addr": addr,
            "bytes": instr.getOpcode().hex(),
            "disasm": instr.getDisassembly(),
            "raxAst": rax_ast,
        })
        addr += instr.getSize()
        offset += instr.getSize()
        # Sicurezza: massimo 64 istruzioni per harness (evita loop infiniti).
        if executed >= 64:
            break

    rax_concrete = ctx.getConcreteRegisterValue(REG.RAX)
    print(json.dumps({
        "ok": True,
        "executed": executed,
        "partial": False,
        "rax": rax_concrete,
        "perInstruction": per_instruction,
    }))


if __name__ == "__main__":
    main()