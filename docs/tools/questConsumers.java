// Recover original quest consumers by decoded string-pool IDs, without changing the program.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;
import java.util.*;
public class questConsumers extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs(); File dir=new File(args[0]); dir.mkdirs();
  PrintWriter refs=new PrintWriter(new File(dir,"refs.txt")); Set<Function> fs=new LinkedHashSet<>();
  InstructionIterator instructions=currentProgram.getListing().getInstructions(true);
  while(instructions.hasNext()) {
   Instruction instruction=instructions.next(); if(!instruction.getMnemonicString().equals("PUSH"))continue;
   Scalar scalar=instruction.getScalar(0); if(scalar==null)continue; long id=scalar.getUnsignedValue();
   if(id<3198||id>3232)continue;
   Function f=getFunctionContaining(instruction.getAddress());
   refs.println("STRING_ID "+id+" INS "+instruction.getAddress()+" FUNCTION "+(f==null?"NONE":f.getEntryPoint()));
   if(f!=null)fs.add(f);
  }
  refs.close(); DecompInterface decompiler=new DecompInterface(); decompiler.openProgram(currentProgram);
  for(Function f:fs) {
   PrintWriter out=new PrintWriter(new File(dir,f.getEntryPoint()+".c.txt"));
   out.println("PROGRAM "+currentProgram.getName()+" FUNCTION "+f.getEntryPoint());
   DecompileResults result=decompiler.decompileFunction(f,90,monitor);
   out.println(result.decompileCompleted()?result.getDecompiledFunction().getC():result.getErrorMessage());out.close();
  }
  decompiler.dispose();
 }
}
