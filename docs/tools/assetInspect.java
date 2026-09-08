import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
public class assetInspect extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();PrintWriter out=new PrintWriter(args[0]);
  for(int i=1;i<args.length;i++){
   Address a=toAddr(args[i]);out.println("ADDRESS "+a);
   byte[] bytes=new byte[256];int got=currentProgram.getMemory().getBytes(a,bytes);
   for(int j=0;j<got;j++){if(j%16==0)out.print("\n"+a.add(j)+": ");out.printf("%02x ",bytes[j]&255);}out.println();
   ReferenceIterator rs=currentProgram.getReferenceManager().getReferencesTo(a);
   while(rs.hasNext()){Reference r=rs.next();Function f=getFunctionContaining(r.getFromAddress());out.println("XREF "+r.getFromAddress()+" "+r.getReferenceType()+" function="+(f==null?"none":f.getEntryPoint()+" "+f.getName()));}
   Function f=getFunctionContaining(a);if(f!=null){InstructionIterator it=currentProgram.getListing().getInstructions(f.getBody(),true);while(it.hasNext()){Instruction ins=it.next();out.println(ins.getAddress()+" "+ins);}}
  }out.close();
 }
}
