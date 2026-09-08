// Repair verified analysis artifacts only; never modifies input executable bytes.
import ghidra.app.script.GhidraScript;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.symbol.*;
import java.io.*;
public class clientRepair extends GhidraScript {
 public void run() throws Exception {
  String[] a=getScriptArgs();PrintWriter o=new PrintWriter(a[0]);
  for(String s:a[1].split(",")){Address p=toAddr(s);Function f=getFunctionAt(p);if(f!=null){o.println("FUNCTION "+p+" noReturn="+f.hasNoReturn());InstructionIterator is=currentProgram.getListing().getInstructions(f.getBody(),true);int n=0;while(is.hasNext()&&n++<60){Instruction i=is.next();o.println(i.getAddress()+" "+i);}}}
  if(a.length>2)for(String s:a[2].split(",")){Function f=getFunctionAt(toAddr(s));if(f!=null){f.setNoReturn(false);o.println("REPAIR noReturn false "+s);ReferenceIterator rs=currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());while(rs.hasNext()){Reference r=rs.next();Instruction i=getInstructionAt(r.getFromAddress());if(i!=null&&i.getFlowType().isCall()){i.setFlowOverride(FlowOverride.NONE);disassemble(i.getMaxAddress().add(1));}}}}
  if(a.length>3)for(String s:a[3].split(",")){String[] p=s.split(":");Function f=getFunctionAt(toAddr(p[0]));f.setCallFixup(p[1]);o.println("FIXUP "+s);}
  if(a.length>4)for(String s:a[4].split(",")){Function f=getFunctionAt(toAddr(s));if(f!=null)CreateFunctionCmd.fixupFunctionBody(currentProgram,f,monitor);}
  o.close();
 }
}
