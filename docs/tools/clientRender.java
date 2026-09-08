// Export bounded address range from the original renderer, not third-party source.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
public class clientRender extends GhidraScript {
 public void run() throws Exception {
  String[] a=getScriptArgs();File dir=new File(a[0]);dir.mkdirs();
  PrintWriter index=new PrintWriter(new File(dir,"index.txt"));
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  FunctionIterator fs=currentProgram.getFunctionManager().getFunctions(toAddr(a[1]),true);
  long end=Long.parseLong(a[2],16); int count=0;
  while(fs.hasNext()) {Function f=fs.next();if(f.getEntryPoint().getOffset()>=end)break;
   index.println(f.getEntryPoint()+" "+f.getName());
   PrintWriter o=new PrintWriter(new File(dir,f.getEntryPoint()+".c.txt"));
   o.println("PROGRAM "+currentProgram.getName()+" FUNCTION "+f.getEntryPoint()+" "+f.getName());
   ReferenceIterator rs=currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());while(rs.hasNext()){Reference r=rs.next();o.println("XREF "+r.getFromAddress()+" "+r.getReferenceType());}
   DecompileResults result=d.decompileFunction(f,30,monitor);o.println(result.decompileCompleted()?result.getDecompiledFunction().getC():result.getErrorMessage());o.close();count++;
  }
  index.close();d.dispose();println("Exported "+count+" functions");
 }
}
