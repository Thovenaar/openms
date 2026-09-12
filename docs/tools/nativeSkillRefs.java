import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.PrintWriter;
import java.util.HashSet;

public class nativeSkillRefs extends GhidraScript {
  public void run() throws Exception {
    String[] args = getScriptArgs();
    HashSet<Long> values = new HashSet<>();
    for (String value : args[1].split(",")) values.add(Long.decode(value));
    try (PrintWriter out = new PrintWriter(args[0])) {
      out.println("PROGRAM " + currentProgram.getName() + " SHA256 " + currentProgram.getExecutableSHA256());
      out.println("EXECUTABLE " + currentProgram.getExecutablePath() + " IMAGE_BASE " + currentProgram.getImageBase());
      InstructionIterator instructions = currentProgram.getListing().getInstructions(true);
      while (instructions.hasNext()) {
        Instruction instruction = instructions.next();
        boolean match = false;
        for (int index = 0; index < instruction.getNumOperands(); index++) {
          for (Object operand : instruction.getOpObjects(index)) {
            long value = operand instanceof Scalar ? ((Scalar) operand).getUnsignedValue()
              : operand instanceof Address ? ((Address) operand).getOffset() : -1;
            if (values.contains(value)) match = true;
          }
        }
        if (!match) continue;
        Function function = getFunctionContaining(instruction.getAddress());
        out.println(instruction.getAddress() + " " + instruction + " FUNCTION "
          + (function == null ? "NONE" : function.getEntryPoint()));
      }
    }
  }
}
