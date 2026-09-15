// Read-only: find dwords equal to given values anywhere in initialized memory.
// Used to locate vtables that contain a known method address.
// lagDwordScan.java <out.txt> <value,...>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.MemoryBlock;
import java.io.PrintWriter;
import java.util.HashSet;
import java.util.Set;

public class lagDwordScan extends GhidraScript {
    private static final int MAX_BLOCK = 0x4000000;

    public void run() throws Exception {
        String[] args = getScriptArgs();
        Set<Long> values = new HashSet<>();
        for (String value : args[1].split(",")) values.add(Long.decode(value) & 0xffffffffL);
        try (PrintWriter out = new PrintWriter(args[0])) {
            out.println("PROGRAM " + currentProgram.getName());
            for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
                if (!block.isInitialized() || block.getSize() > MAX_BLOCK) continue;
                int size = (int) block.getSize();
                byte[] data = new byte[size];
                block.getBytes(block.getStart(), data);
                for (int i = 0; i + 4 <= size; i += 4) {
                    long dword = ((data[i] & 255L) | ((data[i + 1] & 255L) << 8)
                            | ((data[i + 2] & 255L) << 16) | ((data[i + 3] & 255L) << 24)) & 0xffffffffL;
                    if (!values.contains(dword)) continue;
                    Address at = block.getStart().add(i);
                    Function function = getFunctionContaining(at);
                    out.printf("HIT %08x %08x %s%n", at.getOffset(), dword,
                            function == null ? "" : function.getEntryPoint().toString());
                }
            }
        }
    }
}
