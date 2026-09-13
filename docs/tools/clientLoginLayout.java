// Bounded original-client decompilation. Run only in an owned scratch Ghidra project.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;
public class clientLoginLayout extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();String[] addresses=args[1].split(",");
  if(addresses.length>24)throw new IllegalArgumentException("24 functions maximum");
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  try(PrintWriter out=new PrintWriter(args[0])) {
   out.println("PROGRAM "+currentProgram.getName());
   for(String s:addresses){Address a=toAddr(s);disassemble(a);Function f=getFunctionAt(a);if(f==null)f=createFunction(a,null);
    if(f==null)throw new IllegalStateException("No function "+s);
    out.println("FUNCTION "+a);DecompileResults r=d.decompileFunction(f,30,monitor);out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():r.getErrorMessage());
    InstructionIterator is=currentProgram.getListing().getInstructions(f.getBody(),true);int count=0;
    while(is.hasNext()){if(++count>5000)throw new IllegalStateException("Instruction bound");Instruction i=is.next();out.println(i.getAddress()+" "+i);}
   }
  }finally{d.dispose();}
 }
}
