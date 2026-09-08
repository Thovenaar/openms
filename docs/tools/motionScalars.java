import ghidra.app.script.GhidraScript;
import ghidra.program.model.mem.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class motionScalars extends GhidraScript {
 public void run() throws Exception {
  PrintWriter out=new PrintWriter(getScriptArgs()[0]);
  for(MemoryBlock b:currentProgram.getMemory().getBlocks()) {
   if(!b.isInitialized() || b.isExecute() || b.getSize()>32000000)continue;
   for(long n=0;n<b.getSize()-8;n+=4) {
    double v=Double.longBitsToDouble(getLong(b.getStart().add(n)));
    if(v!=100.0)continue;
    out.println("DOUBLE "+b.getStart().add(n)+" "+v);
    ReferenceIterator refs=currentProgram.getReferenceManager().getReferencesTo(b.getStart().add(n));
    while(refs.hasNext()){Reference r=refs.next();Function f=getFunctionContaining(r.getFromAddress());out.println(" XREF "+r.getFromAddress()+" "+(f==null?"NONE":f.getEntryPoint()));}
   }
  }
  out.close();
 }
}
