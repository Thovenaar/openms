import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;
public class combatFields extends GhidraScript {
 public void run() throws Exception {
  PrintWriter out=new PrintWriter(getScriptArgs()[0]);
  InstructionIterator it=currentProgram.getListing().getInstructions(toAddr(0x662000),true);
  while(it.hasNext()) { Instruction i=it.next(); if(i.getAddress().getOffset()>=0x679900)break;
   String s=i.toString(); if(s.contains("0x4c8")||s.contains("0x4dc")) {Function f=getFunctionContaining(i.getAddress());out.println(i.getAddress()+" "+s+" FUNCTION "+(f==null?"NONE":f.getEntryPoint()));}
  } out.close();
 }
}
