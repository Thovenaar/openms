// Ghidra headless evidence exporter; original binaries only.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;

public class assetExport extends GhidraScript {
 public void run() throws Exception {
  File dir=new File(getScriptArgs()[0],currentProgram.getName()); dir.mkdirs();
  PrintWriter meta=new PrintWriter(new File(dir,"metadata.txt"));
  meta.println("Name: "+currentProgram.getName()+"\nMD5: "+currentProgram.getExecutableMD5()+"\nSHA256: "+currentProgram.getExecutableSHA256()+"\nImage base: "+currentProgram.getImageBase()+"\nLanguage: "+currentProgram.getLanguageID());
  SymbolIterator syms=currentProgram.getSymbolTable().getAllSymbols(true);
  while(syms.hasNext()){ Symbol s=syms.next(); if(s.isExternal()||s.getSource()!=SourceType.DEFAULT) meta.println(s.getAddress()+" "+s.getSymbolType()+" "+s.getName(true)); }
  meta.close();
  PrintWriter strings=new PrintWriter(new File(dir,"strings.txt"));
  DataIterator dit=currentProgram.getListing().getDefinedData(true);
  while(dit.hasNext()){Data d=dit.next();if(d.hasStringValue()){strings.println(d.getAddress()+" "+d.getDefaultValueRepresentation()); ReferenceIterator rs=currentProgram.getReferenceManager().getReferencesTo(d.getAddress());while(rs.hasNext())strings.println("  <- "+rs.next().getFromAddress());}}
  strings.close();
  DecompInterface decomp=new DecompInterface(); decomp.openProgram(currentProgram);
  PrintWriter out=new PrintWriter(new File(dir,"decompiled.c"));
  FunctionIterator fs=currentProgram.getFunctionManager().getFunctions(true);
  while(fs.hasNext()&&!monitor.isCancelled()){Function f=fs.next();if(f.isExternal())continue;out.println("\n/* ADDRESS "+f.getEntryPoint()+" "+f.getName()+" */"); DecompileResults r=decomp.decompileFunction(f,45,monitor); if(r.decompileCompleted())out.println(r.getDecompiledFunction().getC());else out.println("/* ERROR "+r.getErrorMessage()+" */");}
  out.close(); decomp.dispose();
 }
}
