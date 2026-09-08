import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;
public class hitboxConstants extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();long selected=args.length>1?Long.decode(args[1]):0;
  PrintWriter out=new PrintWriter(args[0]);InstructionIterator it=currentProgram.getListing().getInstructions(true);
  while(it.hasNext()){Instruction i=it.next();for(int n=0;n<i.getNumOperands();n++)for(Object o:i.getOpObjects(n)){if(!(o instanceof Scalar))continue;long v=((Scalar)o).getSignedValue();if(selected!=0?v!=selected:v!=-50&&v!=-60&&v!=-10&&v!=-25)continue;Function f=getFunctionContaining(i.getAddress());out.println(i.getAddress()+" FUNCTION "+(f==null?"NONE":f.getEntryPoint())+" "+i);}}
  out.close();
 }
}
