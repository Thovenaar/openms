// Read-only: dump named/imported symbols (optionally filtered).
// nativeSymbols.java <out.txt> <regex|*>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import java.io.PrintWriter;

public class nativeSymbols extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String pattern = args.length > 1 ? args[1] : "*";
        try (PrintWriter out = new PrintWriter(args[0])) {
            out.println("PROGRAM " + currentProgram.getName());
            SymbolIterator symbols = currentProgram.getSymbolTable().getAllSymbols(true);
            int total = 0, named = 0;
            while (symbols.hasNext()) {
                Symbol symbol = symbols.next();
                String name = symbol.getName();
                total++;
                if (name.matches("FUN_[0-9a-f]+") || name.matches("DAT_[0-9a-f]+") || name.matches("LAB_[0-9a-f]+")
                        || name.matches("UNK_[0-9a-f]+") || name.matches("SUB_[0-9a-f]+") || name.matches("PTR_[A-Za-z0-9_]+")
                        || name.matches("_?DAT_[0-9a-f]+") || name.matches("s_[-A-Za-z0-9_]+_[0-9a-f]+")) continue;
                named++;
                if (!pattern.equals("*") && !name.matches("(?i).*" + pattern + ".*")) continue;
                out.println(symbol.getAddress() + " " + symbol.getSymbolType() + " " + name);
            }
            out.println("SYMBOLS_TOTAL " + total + " NAMED " + named);
        }
    }
}
