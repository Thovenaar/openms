// Read-only: find addresses whose dword sequence matches a reference vtable at many offsets.
// lagVtableMatch.java <out.txt> <refAddr> <refCount> <minMatches>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.mem.MemoryBlock;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;

public class lagVtableMatch extends GhidraScript {
    private static final int MAX_BLOCK = 0x4000000;

    public void run() throws Exception {
        String[] args = getScriptArgs();
        long reference = Long.parseLong(args[1], 16);
        int refCount = Integer.parseInt(args[2]);
        int minMatches = Integer.parseInt(args[3]);
        List<Long> entries = new ArrayList<>();
        for (int i = 0; i < refCount; i++) entries.add(getInt(toAddr(reference + i * 4L)) & 0xffffffffL);
        try (PrintWriter out = new PrintWriter(args[0])) {
            out.println("REFERENCE " + args[1] + " COUNT " + refCount);
            for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
                if (!block.isInitialized() || block.getSize() > MAX_BLOCK) continue;
                int size = (int) block.getSize();
                byte[] data = new byte[size];
                block.getBytes(block.getStart(), data);
                long base = block.getStart().getOffset();
                for (int i = 0; i + refCount * 4 <= size; i += 4) {
                    if (base + i == reference) continue;
                    long first = ((data[i] & 255L) | ((data[i + 1] & 255L) << 8)
                            | ((data[i + 2] & 255L) << 16) | ((data[i + 3] & 255L) << 24)) & 0xffffffffL;
                    if (first != entries.get(0)) continue;
                    int matches = 0;
                    for (int k = 0; k < refCount; k++) {
                        long value = ((data[i + k * 4] & 255L) | ((data[i + k * 4 + 1] & 255L) << 8)
                                | ((data[i + k * 4 + 2] & 255L) << 16) | ((data[i + k * 4 + 3] & 255L) << 24)) & 0xffffffffL;
                        if (value == entries.get(k)) matches++;
                    }
                    if (matches < minMatches) continue;
                    out.printf("MATCH %08x COUNT %d%n", base + i, matches);
                    for (int k = 0; k < refCount; k++) {
                        long value = ((data[i + k * 4] & 255L) | ((data[i + k * 4 + 1] & 255L) << 8)
                                | ((data[i + k * 4 + 2] & 255L) << 16) | ((data[i + k * 4 + 3] & 255L) << 24)) & 0xffffffffL;
                        out.printf("  +%02x %08x%s%n", k * 4, value, value == entries.get(k) ? "" : " *");
                    }
                }
            }
        }
    }
}
