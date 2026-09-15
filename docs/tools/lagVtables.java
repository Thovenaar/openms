// Read-only: find maximal runs of dwords that resolve to function entries (candidate vtables).
// lagVtables.java <out.txt> <minRun> <rangeStart:rangeEnd>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.MemoryBlock;
import java.io.PrintWriter;

public class lagVtables extends GhidraScript {
    private static final int MAX_BLOCK = 0x4000000;
    private static final int MAX_ENTRIES = 96;

    public void run() throws Exception {
        String[] args = getScriptArgs();
        int minRun = Integer.parseInt(args[1]);
        String[] range = args[2].split(":");
        long start = Long.parseLong(range[0], 16);
        long end = Long.parseLong(range[1], 16);
        try (PrintWriter out = new PrintWriter(args[0])) {
            out.println("PROGRAM " + currentProgram.getName());
            for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
                if (!block.isInitialized() || block.getSize() > MAX_BLOCK) continue;
                long blockStart = block.getStart().getOffset();
                long blockEnd = blockStart + block.getSize();
                if (blockEnd <= start || blockStart >= end) continue;
                int size = (int) block.getSize();
                byte[] data = new byte[size];
                block.getBytes(block.getStart(), data);
                int i = 0;
                while (i + 4 <= size) {
                    long dword = readDword(data, i);
                    Address address = toAddr(dword);
                    Function function = getFunctionAt(address);
                    if (function == null) { i += 4; continue; }
                    int runStart = i;
                    int count = 0;
                    while (i + 4 <= size && count < MAX_ENTRIES) {
                        long value = readDword(data, i);
                        if (getFunctionAt(toAddr(value)) == null) break;
                        i += 4;
                        count++;
                    }
                    if (count >= minRun) {
                        out.printf("VTABLE %08x ENTRIES %d%n", blockStart + runStart, count);
                        for (int index = 0; index < count; index++) {
                            long value = readDword(data, runStart + index * 4);
                            out.printf("  +%02x %08x %s%n", index * 4, value,
                                    getFunctionAt(toAddr(value)).getName());
                        }
                    }
                }
            }
        }
    }

    private long readDword(byte[] data, int offset) {
        return ((data[offset] & 255L) | ((data[offset + 1] & 255L) << 8)
                | ((data[offset + 2] & 255L) << 16) | ((data[offset + 3] & 255L) << 24)) & 0xffffffffL;
    }
}
