#!/usr/bin/env python3
"""Unicorn execution harness (M2 — behavioral testing).

Legge JSON su stdin: {"codeHex": "...", "baseAddr": 4198400}
Esegue il codice x86-64 in emulazione fermandosi PRIMA dell'ultima istruzione
(convenzione: il codice termina con RET, quindi RAX è l'output della funzione).
Una syscall/exit che sborda oltre il mapping è una terminazione legittima:
si legge EAX comunque. Stampa JSON: {"ok": true, "rax": N, "executed": true}
"""
import json
import sys

from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UcError
from unicorn.x86_const import UC_X86_REG_EAX

BASE = 0x401000


def main() -> None:
    data = json.load(sys.stdin)
    code = bytes.fromhex(data["codeHex"])
    uc = Uc(UC_ARCH_X86, UC_MODE_64)
    uc.mem_map(BASE, 0x1000)
    uc.mem_write(BASE, code)
    try:
        uc.emu_start(BASE, BASE + len(code) - 1)
    except UcError:
        # Sbordata oltre il mapping = terminazione (exit/syscall): legittima.
        pass
    rax = uc.reg_read(UC_X86_REG_EAX)
    print(json.dumps({"ok": True, "rax": rax, "executed": True}))


if __name__ == "__main__":
    main()
