// Bounded original instruction operand scan; never mutates the program.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;
import java.util.*;

public class clientFieldRefs extends GhidraScript {
  public void run() throws Exception {
    String[] args = getScriptArgs();
    if (args.length != 4) throw new IOException("output start end offsets required");
    long start = Long.parseLong(args[1], 16), end = Long.parseLong(args[2], 16);
    if (start >= end) throw new IOException("Invalid instruction interval");
    Set<Long> offsets = new HashSet<>();
    for (String value : args[3].split(",")) offsets.add(Long.decode(value));
    if (offsets.size() > 32) throw new IOException("Offset bound exceeded");
    try (PrintWriter out = new PrintWriter(args[0])) {
      out.println("PROGRAM " + currentProgram.getName());
      InstructionIterator instructions = currentProgram.getListing().getInstructions(toAddr(start), true);
      int scanned = 0, found = 0;
      while (instructions.hasNext()) {
        Instruction instruction = instructions.next();
        if (instruction.getAddress().getOffset() >= end) break;
        if (++scanned > 10000000) throw new IOException("Instruction bound exceeded");
        String mnemonic = instruction.getMnemonicString();
        if (!mnemonic.equals("LEA") && !mnemonic.equals("ADD") && !mnemonic.equals("MOV")) continue;
        boolean matches = false;
        for (int operand = 0; operand < instruction.getNumOperands(); operand++) {
          for (Object part : instruction.getOpObjects(operand)) {
            if (part instanceof Scalar && offsets.contains(((Scalar) part).getUnsignedValue())) matches = true;
          }
        }
        if (!matches) continue;
        if (++found > 4096) throw new IOException("Reference bound exceeded");
        Function function = getFunctionContaining(instruction.getAddress());
        out.println(instruction.getAddress() + " " + instruction + " FUNCTION " + (function == null ? "UNKNOWN" : function.getEntryPoint()));
      }
      out.println("INSTRUCTIONS_SCANNED " + scanned + " REFERENCES " + found);
    }
  }
}
