import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class assetRecover extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();PrintWriter out=new PrintWriter(args[0]);DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  for(int i=1;i<args.length;i++){
   Address a=toAddr(args[i]);Function f=getFunctionAt(a);if(f==null){disassemble(a);f=createFunction(a,"recovered_"+a);}
   out.println("/* ADDRESS "+a+" */");if(f==null){out.println("Function creation failed");continue;}
   DecompileResults r=d.decompileFunction(f,60,monitor);if(r.decompileCompleted())out.println(r.getDecompiledFunction().getC());else out.println(r.getErrorMessage());
   InstructionIterator it=currentProgram.getListing().getInstructions(f.getBody(),true);while(it.hasNext()){Instruction ins=it.next();out.println("// "+ins.getAddress()+" "+ins);}
  }d.dispose();out.close();
 }
}
