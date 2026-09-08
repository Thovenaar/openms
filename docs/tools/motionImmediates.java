import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;
public class motionImmediates extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();
  PrintWriter out=new PrintWriter(args[0]);
  String[] needles=args[1].split(",");
  InstructionIterator it=currentProgram.getListing().getInstructions(true);
  while(it.hasNext()) {
   Instruction ins=it.next();String text=ins.toString();
   boolean match=false;for(String needle:needles)if(text.contains(needle)){match=true;break;}
   if(!match)continue;
   Function f=getFunctionContaining(ins.getAddress());
   out.println(ins.getAddress()+" "+text+" FUNCTION "+(f==null?"NONE":f.getEntryPoint()));
  }
  out.close();
 }
}
