#!/usr/bin/env python3
"""
Valutazione re-executability — logica UFFICIALE di Decompile-Bench (LLM4Binary,
MIT), eseguita dentro il container linux/amd64 del protocollo.

La funzione execute_rate è copiata verbatim da:
  decompile-bench/metrics/cal_execute_rate.py (LLM4Decompile, MIT)
Il protocollo pubblico compila il candidato con -O0 (default di
execute_rate_main, usato da run_exe_rate.py) indipendentemente dall'opt della
riga: `opt` del corpus indica il livello di ottimizzazione del binario
originale, non del ricompilato.

I/O: jsonl su stdin {id, func_dep, candidate, test, language, opt} ->
     jsonl su stdout {id, comp, exe} (ordine input preservato).
Parallelismo: env DBENCH_WORKERS (default 8) thread (multiprocessing.dummy:
gcc è subprocess-bound; il fork di Pool crasha silenziosamente sotto emulazione
qemu/linux-amd64 su host macOS).
"""
import json
import os
import sys
from multiprocessing.dummy import Pool

from cal_execute_rate import execute_rate  # verbatim, MIT


def _eval(row: dict) -> dict:
    comp, exe = execute_rate(
        row["func_dep"],
        row["candidate"],
        row["test"],
        timeout=10,
        language=row["language"],
        opt="-O0",  # default ufficiale di execute_rate_main
    )
    return {"id": row["id"], "comp": comp, "exe": exe}


def main() -> None:
    rows = [json.loads(line) for line in sys.stdin if line.strip()]
    workers = int(os.environ.get("DBENCH_WORKERS", "8"))
    if workers > 1:
        with Pool(workers) as pool:
            results = pool.map(_eval, rows, chunksize=4)
    else:
        results = [_eval(r) for r in rows]
    # I risultati escono su fd 3 (se presente): i subprocess figli (gcc, binario
    # di test) ereditano fd 1 e possono stampare sullo stdout del container.
    try:
        out = os.fdopen(3, "w")
    except OSError:
        out = sys.stdout
    with out:
        out.write("".join(json.dumps(r) + "\n" for r in results))


if __name__ == "__main__":
    main()
