import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.*;
public class hitboxRectCalls extends GhidraScript {
 public void run() throws Exception {
  File dir=new File(getScriptArgs()[0]);dir.mkdirs();PrintWriter index=new PrintWriter(new File(dir,"index.txt"));Set<Function> callers=new LinkedHashSet<>();
  SymbolIterator symbols=currentProgram.getSymbolTable().getAllSymbols(true);
  while(symbols.hasNext()){Symbol s=symbols.next();if(!s.getName().matches(".*(SetRect|IntersectRect|PtInRect|OffsetRect).*"))continue;index.println("TARGET "+s.getAddress()+" "+s.getName());ReferenceIterator rs=currentProgram.getReferenceManager().getReferencesTo(s.getAddress());while(rs.hasNext()){Reference r=rs.next();Function c=getFunctionContaining(r.getFromAddress());index.println(r.getFromAddress()+" "+(c==null?"NONE":c.getEntryPoint()));if(c!=null)callers.add(c);}}
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  for(Function f:callers){DecompileResults r=d.decompileFunction(f,30,monitor);PrintWriter o=new PrintWriter(new File(dir,f.getEntryPoint()+".txt"));o.println("FUNCTION "+f.getEntryPoint());o.println(r.decompileCompleted()?r.getDecompiledFunction().getC():r.getErrorMessage());o.close();}
  index.close();d.dispose();
 }
}
