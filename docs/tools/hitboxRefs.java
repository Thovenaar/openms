import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;
import java.util.*;
public class hitboxRefs extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();PrintWriter out=new PrintWriter(args[0]);
  Set<Long> ids=new HashSet<>();for(String id:args[1].split(","))ids.add(Long.decode(id));
  InstructionIterator instructions=currentProgram.getListing().getInstructions(true);
  while(instructions.hasNext()) {Instruction i=instructions.next();if(!i.getMnemonicString().equals("PUSH"))continue;Scalar s=i.getScalar(0);if(s==null||!ids.contains(s.getUnsignedValue()))continue;Function f=getFunctionContaining(i.getAddress());out.println("ID "+s.getUnsignedValue()+" INS "+i.getAddress()+" FUNCTION "+(f==null?"NONE":f.getEntryPoint()));}
  out.close();
 }
}
