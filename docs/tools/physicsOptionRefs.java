// Original-client scalar string-ID consumers; bounded instruction scan, no binary mutation.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;
import java.util.*;
public class physicsOptionRefs extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs(); PrintWriter out=new PrintWriter(args[0]);
  Set<Long> ids=new HashSet<>(); for(String id:args[1].split(",")) ids.add(Long.decode(id));
  InstructionIterator instructions=currentProgram.getListing().getInstructions(true);
  int count=0;
  while(instructions.hasNext()) {
   if(++count>10000000) throw new IOException("Instruction bound exceeded");
   Instruction instruction=instructions.next(); if(!instruction.getMnemonicString().equals("PUSH")) continue;
   Scalar value=instruction.getScalar(0); if(value==null || !ids.contains(value.getUnsignedValue())) continue;
   Function function=getFunctionContaining(instruction.getAddress());
   out.println("STRING_ID "+value.getUnsignedValue()+" INS "+instruction.getAddress()+" FUNCTION "+(function==null?"UNKNOWN":function.getEntryPoint()));
  }
  out.println("INSTRUCTIONS_SCANNED "+count); out.close();
 }
}
