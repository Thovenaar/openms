import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;
public class motionCadence extends GhidraScript {
 public void run() throws Exception {
  PrintWriter out=new PrintWriter(getScriptArgs()[0]);
  InstructionIterator it=currentProgram.getListing().getInstructions(toAddr("009b0000"),true);
  while(it.hasNext()) {
   Instruction i=it.next(); if(i.getAddress().getOffset()>=0x009d0000)break;
   String text=i.toString();
   if(!text.contains("0x1e") && !text.contains("+ 0x28]"))continue;
   Function f=getFunctionContaining(i.getAddress());
   out.println(i.getAddress()+" "+text+" FUNCTION "+(f==null?"NONE":f.getEntryPoint()));
  }
  out.close();
 }
}
