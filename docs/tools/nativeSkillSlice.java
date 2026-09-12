import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import java.io.PrintWriter;

public class nativeSkillSlice extends GhidraScript {
  public void run() throws Exception {
    String[] args = getScriptArgs();
    Address start = toAddr(args[1]);
    Address end = toAddr(args[2]);
    try (PrintWriter out = new PrintWriter(args[0])) {
      InstructionIterator instructions = currentProgram.getListing().getInstructions(start, true);
      int count = 0;
      while (instructions.hasNext() && count++ < 10000) {
        Instruction instruction = instructions.next();
        if (instruction.getAddress().compareTo(end) > 0) break;
        out.println(instruction.getAddress() + " " + instruction);
      }
    }
  }
}
