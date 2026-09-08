// Address-directed original-client decompilation and reference export.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.address.*;
import java.io.*;
public class clientFocus extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs(); PrintWriter out=new PrintWriter(args[0]);
  DecompInterface d=new DecompInterface(); d.openProgram(currentProgram);
  for(String token:args[1].split(",")) {
   String[] part=token.split(":"); Address a=toAddr(part[0]);
   if(part.length>1) { int count=Integer.decode(part[1]); for(int i=0;i<count;i++) { Address p=a.add(i*4); out.printf("DWORD %s %08x%n",p,getInt(p)); } continue; }
   out.println("ADDRESS "+a); ReferenceIterator refs=currentProgram.getReferenceManager().getReferencesTo(a);
   while(refs.hasNext()) {Reference r=refs.next(); Function f=getFunctionContaining(r.getFromAddress());out.println(" XREF "+r.getFromAddress()+" "+r.getReferenceType()+" "+(f==null?"":f.getEntryPoint()));}
   Function f=getFunctionContaining(a); if(f==null) f=createFunction(a,null);
   if(f!=null) { out.println("FUNCTION "+f.getEntryPoint()+" "+f.getName());DecompileResults r=d.decompileFunction(f,90,monitor);out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():r.getErrorMessage()); }
   out.flush();
  }
  d.dispose();out.close();
 }
}
