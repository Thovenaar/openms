// Read-only: list recovered function entry points in bounded address ranges.
// nativeFunctions.java <out.txt> <start:end,...>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import java.io.PrintWriter;

public class nativeFunctions extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        try (PrintWriter out = new PrintWriter(args[0])) {
            out.println("PROGRAM " + currentProgram.getName());
            for (String range : args[1].split(",")) {
                String[] parts = range.split(":");
                long start = Long.parseLong(parts[0], 16);
                long end = Long.parseLong(parts[1], 16);
                int count = 0;
                FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(toAddr(start), true);
                while (functions.hasNext()) {
                    Function function = functions.next();
                    Address entry = function.getEntryPoint();
                    if (entry.getOffset() >= end) break;
                    out.printf("FUNC %08x %6d %s%n", entry.getOffset(), function.getBody().getNumAddresses(), function.getName());
                    count++;
                }
                out.println("RANGE " + range + " FUNCTIONS " + count);
            }
        }
    }
}
