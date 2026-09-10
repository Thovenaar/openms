// Bounded instruction-operand inventory for the original world-depth band.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;
public class clientDepthRefs extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();
  try(PrintWriter out=new PrintWriter(args[0])) {
   out.println("PROGRAM "+currentProgram.getName());
   InstructionIterator instructions=currentProgram.getListing().getInstructions(true);
   long count=0;
   while(instructions.hasNext() && !monitor.isCancelled()) {
    Instruction instruction=instructions.next();
    if(++count>10000000) throw new IOException("Instruction limit exceeded");
    for(int operand=0;operand<instruction.getNumOperands();operand++) {
     for(Object object:instruction.getOpObjects(operand)) {
      if(!(object instanceof Scalar)) continue;
      long value=((Scalar)object).getUnsignedValue() & 0xffffffffL;
      if(value<0xc0007500L || value>0xc0007600L) continue;
      Function function=getFunctionContaining(instruction.getAddress());
      out.println(instruction.getAddress()+" "+instruction+" FUNCTION "+(function==null?"unknown":function.getEntryPoint()));
     }
    }
   }
  }
 }
}
