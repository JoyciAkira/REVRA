# debug: elenca le funzioni con indirizzo, per capire il mapping simboli Ghidra
# @category: REVRA
fm = currentProgram.getFunctionManager()
for f in fm.getFunctions(True):
    print("FN %s %s" % (f.getEntryPoint(), f.getName()))
