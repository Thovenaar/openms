import ghidra.app.script.GhidraScript;
import ghidra.program.model.mem.*;
import java.io.*;
public class motionTypes extends GhidraScript {
 public void run() throws Exception {
  PrintWriter out = new PrintWriter(getScriptArgs()[0]);
  for (MemoryBlock b: currentProgram.getMemory().getBlocks()) {
   if (!b.isInitialized() || b.getSize()>32000000) continue;
   byte[] data=new byte[(int)b.getSize()]; b.getBytes(b.getStart(),data);
   for(int i=0;i<data.length-5;i++) {
    if(data[i]!='.' || data[i+1]!='?' || data[i+2]!='A') continue;
    int end=i; while(end<data.length && end-i<200 && data[end]!=0)end++;
    String s=new String(data,i,end-i,"US-ASCII");
    if(s.contains("VecCtrl") || s.contains("Attr") || s.contains("Foothold"))out.println(b.getStart().add(i)+" "+s);
   }
  }
  out.close();
 }
}
