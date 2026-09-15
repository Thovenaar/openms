// Read-only: print instructions that use a chosen displacement inside functions
// referencing a chosen global. Used to locate field writers without symbols.
// lagFieldSites.java <out.txt> <globalAddr> <offsetHex,...>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import java.io.PrintWriter;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;

public class lagFieldSites extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        long global = Long.parseLong(args[1], 16);
        Set<Long> offsets = new HashSet<>();
        for (String value : args[2].split(",")) offsets.add(Long.decode(value));
        Set<Function> functions = new LinkedHashSet<>();
        ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(toAddr(global));
        while (references.hasNext()) {
            Reference reference = references.next();
            Function function = getFunctionContaining(reference.getFromAddress());
            if (function != null) functions.add(function);
        }
        try (PrintWriter out = new PrintWriter(args[0])) {
            out.println("GLOBAL " + args[1] + " FUNCTIONS " + functions.size());
            for (Function function : functions) {
                InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
                while (instructions.hasNext()) {
                    Instruction instruction = instructions.next();
                    for (int operand = 0; operand < instruction.getNumOperands(); operand++) {
                        for (Object part : instruction.getOpObjects(operand)) {
                            if (!(part instanceof Scalar)) continue;
                            if (!offsets.contains(((Scalar) part).getUnsignedValue())) continue;
                            out.println(instruction.getAddress() + " " + instruction + " FUNC " + function.getEntryPoint());
                        }
                    }
                }
            }
        }
    }
}
