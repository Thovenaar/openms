import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;
public class clientInstructions extends GhidraScript {
 public void run() throws Exception {String[] a=getScriptArgs();PrintWriter o=new PrintWriter(a[0]);o.println("PROGRAM "+currentProgram.getName());for(String r:a[1].split(",")){String[] p=r.split(":");long end=Long.parseLong(p[1],16);InstructionIterator is=currentProgram.getListing().getInstructions(toAddr(p[0]),true);while(is.hasNext()){Instruction i=is.next();if(i.getAddress().getOffset()>=end)break;o.println(i.getAddress()+" "+i);}}o.close();}
}
