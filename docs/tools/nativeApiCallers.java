// Read-only: resolve imported-API consumers and decompile each caller once.
// nativeApiCallers.java <outDir> <nameSubstring,...>
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import java.io.File;
import java.io.PrintWriter;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;

public class nativeApiCallers extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        File dir = new File(args[0]);
        dir.mkdirs();
        Set<String> needles = new LinkedHashSet<>(Arrays.asList(args[1].split(",")));
        Set<Function> callers = new LinkedHashSet<>();
        try (PrintWriter index = new PrintWriter(new File(dir, "index.txt"))) {
            SymbolIterator symbols = currentProgram.getSymbolTable().getAllSymbols(true);
            while (symbols.hasNext()) {
                Symbol symbol = symbols.next();
                boolean match = false;
                for (String needle : needles) if (symbol.getName().contains(needle)) match = true;
                if (!match) continue;
                index.println("TARGET " + symbol.getAddress() + " " + symbol.getName());
                ReferenceIterator refs = currentProgram.getReferenceManager().getReferencesTo(symbol.getAddress());
                while (refs.hasNext()) {
                    Reference reference = refs.next();
                    Function caller = getFunctionContaining(reference.getFromAddress());
                    index.println(" XREF " + reference.getFromAddress() + " " + (caller == null ? "NONE" : caller.getEntryPoint()));
                    if (caller != null) callers.add(caller);
                }
            }
            index.println("CALLERS " + callers.size());
        }
        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);
        try (PrintWriter index = new PrintWriter(new File(dir, "callers.txt"))) {
            for (Function function : callers) {
                index.println(function.getEntryPoint() + " " + function.getName());
                PrintWriter out = new PrintWriter(new File(dir, function.getEntryPoint() + ".c.txt"));
                out.println("PROGRAM " + currentProgram.getName() + " FUNCTION " + function.getEntryPoint() + " " + function.getName());
                DecompileResults result = decomp.decompileFunction(function, 90, monitor);
                out.println(result.decompileCompleted() ? result.getDecompiledFunction().getC() : result.getErrorMessage());
                out.close();
            }
        }
        decomp.dispose();
        println("Decompiled " + callers.size() + " callers");
    }
}
