// Original-binary evidence export. Run with Ghidra analyzeHeadless.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.address.*;
import java.io.*;
import java.util.*;

public class clientEvidence extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();
  File dir=new File(args[0]); dir.mkdirs();
  PrintWriter out=new PrintWriter(new File(dir,currentProgram.getName()+".txt"));
  out.println("PROGRAM "+currentProgram.getName()+" IMAGE_BASE "+currentProgram.getImageBase());
  out.println("LANGUAGE "+currentProgram.getLanguageID());
  out.println("EXECUTABLE "+currentProgram.getExecutablePath());
  Set<Function> targets=new LinkedHashSet<>();
  String regex="(?is).*(map/|map\\\\|character|back|tile|origin|delay|zmap|smap|stand1|walk1|jump|ladder|rope|canvas|resman|namespace|gr2d|version|wz|camera|alpha|foothold).*";
  DataIterator data=currentProgram.getListing().getDefinedData(true);
  while(data.hasNext()) {
   Data d=data.next(); Object v=d.getValue();
   if(v instanceof String && ((String)v).matches(regex)) {
    out.println("STRING "+d.getAddress()+" "+v.toString().replace("\n","\\n"));
    ReferenceIterator refs=currentProgram.getReferenceManager().getReferencesTo(d.getAddress());
    while(refs.hasNext()) { Reference r=refs.next(); Function f=getFunctionContaining(r.getFromAddress()); out.println(" XREF "+r.getFromAddress()+" "+r.getReferenceType()+" "+(f==null?"NO_FUNCTION":f.getEntryPoint()+" "+f.getName())); if(f!=null) targets.add(f); }
   }
  }
  SymbolIterator syms=currentProgram.getSymbolTable().getAllSymbols(true);
  while(syms.hasNext()) { Symbol s=syms.next(); if(s.getName().matches(regex)) out.println("SYMBOL "+s.getAddress()+" "+s.getName()); }
  if(args.length>1) for(String addr:args[1].split(",")) { Address a=toAddr(addr); Function f=getFunctionContaining(a); if(f==null) f=createFunction(a,null); if(f!=null) targets.add(f); }
  DecompInterface decomp=new DecompInterface(); decomp.openProgram(currentProgram);
  int n=0;
  for(Function f:targets) { if(n++>200) break; out.println("\nFUNCTION "+f.getEntryPoint()+" "+f.getName()); DecompileResults result=decomp.decompileFunction(f,60,monitor); if(result.decompileCompleted()) out.println(result.getDecompiledFunction().getC()); else out.println("DECOMPILE_ERROR "+result.getErrorMessage()); out.flush(); }
  decomp.dispose(); out.close(); println("Wrote evidence for "+targets.size()+" targeted functions to "+dir);
 }
}
