# Ghidra headless post-script: decompila la funzione contenente l'indirizzo
# dato (hex) e stampa il C delimitato da marker. Jython 2.7 (Ghidra script API).
# @category: REVRA
from ghidra.app.decompiler import DecompInterface, DecompileOptions
from ghidra.util.task import ConsoleTaskMonitor

args = getScriptArgs()
addr_int = int(args[0], 16) + currentProgram.getImageBase().getOffset()
default_space = currentProgram.getAddressFactory().getDefaultAddressSpace()
addr = default_space.getAddress(addr_int)

# ordine: start esatto (simbolo) -> contenitore -> prima funzione dopo
func = getFunctionAt(addr)
if func is None:
    func = getFunctionContaining(addr)
if func is None:
    func = getFunctionAfter(addr)

if func is None:
    print("REVRA_DECOMPILE_ERROR: no function at 0x%x" % addr_int)
else:
    di = DecompInterface()
    di.setOptions(DecompileOptions())
    di.openProgram(currentProgram)
    res = di.decompileFunction(func, 120, ConsoleTaskMonitor())
    if res.decompileCompleted():
        print("REVRA_C_BEGIN %s" % func.getName())
        print(res.getDecompiledFunction().getC())
        print("REVRA_C_END")
    else:
        print("REVRA_DECOMPILE_ERROR: %s" % res.getErrorMessage())
