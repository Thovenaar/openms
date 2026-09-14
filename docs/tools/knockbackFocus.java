// Address-directed original-client decompilation for knockback trajectory recovery.
// Decompiles each comma-separated entry point into one retained evidence file.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;
public class knockbackFocus extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs(); PrintWriter out=new PrintWriter(args[0]);
  out.println("PROGRAM "+currentProgram.getName());
  DecompInterface d=new DecompInterface(); d.openProgram(currentProgram);
  for(String token:args[1].split(",")) {
   Address a=toAddr(token);
   Function f=getFunctionContaining(a); if(f==null) f=createFunction(a,null);
   if(f==null) { out.println("ADDRESS "+a+" NO_FUNCTION"); out.flush(); continue; }
   out.println("ADDRESS "+a+" FUNCTION "+f.getEntryPoint()+" "+f.getName());
   DecompileResults r=d.decompileFunction(f,120,monitor);
   out.println(r.decompileCompleted()?r.getDecompiledFunction().getC():("ERROR "+r.getErrorMessage()));
   out.flush();
  }
  d.dispose();out.close();
 }
}
