// Export consumers of address-identified original-client globals.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.app.cmd.function.CreateFunctionCmd;
import java.io.*;
import java.util.*;
public class clientRefs extends GhidraScript {
 public void run() throws Exception {
  String[] a=getScriptArgs();File dir=new File(a[0]);dir.mkdirs();PrintWriter o=new PrintWriter(new File(dir,"refs.txt"));Set<Function> fs=new LinkedHashSet<>();
  for(String p:a[1].split(",")){ReferenceIterator rs=currentProgram.getReferenceManager().getReferencesTo(toAddr(p));while(rs.hasNext()){Reference r=rs.next();Function f=getFunctionContaining(r.getFromAddress());o.println(p+" XREF "+r.getFromAddress()+" FUNCTION "+(f==null?"NONE":f.getEntryPoint()));if(f!=null)fs.add(f);}}
  o.close();DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  for(Function f:fs){CreateFunctionCmd.fixupFunctionBody(currentProgram,f,monitor);o=new PrintWriter(new File(dir,f.getEntryPoint()+".c.txt"));o.println("PROGRAM "+currentProgram.getName()+" FUNCTION "+f.getEntryPoint());DecompileResults r=d.decompileFunction(f,60,monitor);o.println(r.decompileCompleted()?r.getDecompiledFunction().getC():r.getErrorMessage());o.close();}d.dispose();
 }
}
