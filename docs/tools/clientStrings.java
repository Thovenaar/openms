// Decode original string pool using the algorithm recovered at 0079ebf3/0079ecde.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;
import java.util.*;
public class clientStrings extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();PrintWriter out=new PrintWriter(args[0]);
  int len=getInt(toAddr(0xb001fc)), count=getInt(toAddr(0xb00200));
  byte[] key=getBytes(toAddr(0xb001ec),len);out.println("KEY b001ec "+Arrays.toString(key)+" LENGTH "+len+" COUNT "+count);
  Map<Long,String> selected=new HashMap<>();
  for(int id=0;id<count;id++) {
   long ptr=Integer.toUnsignedLong(getInt(toAddr(0xbdc9d4L+id*4L)));Address p=toAddr(ptr);
   int shift=getByte(p);int byteShift=(shift>>>3)%len;int bitShift=shift&7;byte[] rot=new byte[len];
   for(int i=0;i<len;i++){int cur=key[(i+byteShift)%len]&255,next=key[(i+byteShift+1)%len]&255;rot[i]=(byte)((cur<<bitShift)|(bitShift==0?0:next>>>(8-bitShift)));}
   ByteArrayOutputStream b=new ByteArrayOutputStream();for(int i=0;i<4096;i++){int ch=getByte(p.add(i+1))&255;if(ch==0)break;int x=ch^(rot[i%len]&255);b.write(x==0?(rot[i%len]&255):x);}
   String s=b.toString("UTF-8");out.printf("STRING_ID %d 0x%x ADDRESS %s %s%n",id,id,p,s.replace("\n","\\n").replace("\r","\\r"));
   if(s.matches("(?i).*(Map/|Character/|zmap|smap|ResMan|NameSpace|Gr2D|stand1|walk1).* ".trim())||s.matches("(?i)(origin|map|delay|z|zM|rx|ry|cx|cy|type|back|tile|obj|bS|tS|oS|l0|l1|l2|head|neck|navel|brow|hand|handMove|VRLeft|VRRight|VRTop|VRBottom|front|ani|a|f|zM|layer|foothold)"))selected.put((long)id,s);
  }
  InstructionIterator is=currentProgram.getListing().getInstructions(true);while(is.hasNext()){Instruction i=is.next();if(!i.getMnemonicString().equals("PUSH"))continue;Scalar scalar=i.getScalar(0);if(scalar==null)continue;long v=scalar.getUnsignedValue();if(!selected.containsKey(v))continue;Function f=getFunctionContaining(i.getAddress());if(f!=null)out.println("ID_XREF "+v+" "+selected.get(v)+" INS "+i.getAddress()+" FUNCTION "+f.getEntryPoint());}
  out.close();println("Decoded "+count+" strings, selected "+selected.size());
 }
}
