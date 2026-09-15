// Read-only MSVC RTTI inventory and vtable resolver for the original client.
// Never mutates the program. Usage:
//   nativeRtti.java <out.txt> <filter|*> [vtable]
// filter is a comma-separated list of case-sensitive class-name substrings.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.MemoryBlock;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class nativeRtti extends GhidraScript {
    private static final int MAX_BLOCK = 0x4000000;
    private static final int MAX_NAME = 220;
    private static final int MAX_VTABLE = 160;

    public void run() throws Exception {
        String[] args = getScriptArgs();
        String filter = args.length > 1 ? args[1] : "*";
        boolean withVtables = args.length > 2 && args[2].equals("vtable");
        Set<String> tokens = new HashSet<>();
        if (!filter.equals("*")) for (String token : filter.split(",")) tokens.add(token);

        // Pass 1: locate RTTI type descriptor names (".?AV"/".?AU"/".?AW").
        Map<Long, String> names = new HashMap<>();
        List<Long> ordered = new ArrayList<>();
        for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
            if (!block.isInitialized() || block.getSize() > MAX_BLOCK) continue;
            int size = (int) block.getSize();
            byte[] data = new byte[size];
            block.getBytes(block.getStart(), data);
            long base = block.getStart().getOffset();
            for (int i = 0; i + 4 < size; i++) {
                if (data[i] != '.' || data[i + 1] != '?' || data[i + 2] != 'A') continue;
                int end = i;
                while (end < size && end - i < MAX_NAME && data[end] != 0) end++;
                if (end - i < 5 || end >= size) continue;
                boolean printable = true;
                for (int k = i; k < end; k++) {
                    int c = data[k] & 255;
                    if (c < 0x20 || c > 0x7e) { printable = false; break; }
                }
                if (!printable) continue;
                String name = new String(data, i, end - i, "US-ASCII");
                if (!name.startsWith(".?A")) continue;
                names.put(base + i, name);
                ordered.add(base + i);
            }
        }
        ordered.sort(null);

        try (PrintWriter out = new PrintWriter(args[0])) {
            out.println("PROGRAM " + currentProgram.getName() + " SHA256 " + currentProgram.getExecutableSHA256());
            int listed = 0;
            for (Long address : ordered) {
                String name = names.get(address);
                if (!tokens.isEmpty() && !matches(name.substring(4), tokens)) continue;
                out.printf("TYPE %08x %s%n", address, name);
                listed++;
            }
            out.println("TYPES_TOTAL " + ordered.size() + " LISTED " + listed);
            if (withVtables) resolveVtables(out, names, ordered, tokens);
        }
        println("RTTI names " + ordered.size());
    }

    private boolean matches(String className, Set<String> tokens) {
        for (String token : tokens) if (className.contains(token)) return true;
        return false;
    }

    /** Chain descriptor -> Complete Object Locator -> vtable[-1] -> vtable entries. */
    private void resolveVtables(PrintWriter out, Map<Long, String> names, List<Long> ordered, Set<String> tokens) throws Exception {
        Map<Long, String> targets = new HashMap<>();
        for (Long address : ordered) {
            String name = names.get(address);
            if (tokens.isEmpty() || matches(name.substring(4), tokens)) targets.put(address - 8, name);
        }
        if (targets.isEmpty()) return;
        Map<Long, Long> colToType = new HashMap<>();
        for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
            if (!block.isInitialized() || block.getSize() > MAX_BLOCK) continue;
            int size = (int) block.getSize();
            byte[] data = new byte[size];
            block.getBytes(block.getStart(), data);
            for (int i = 0; i + 4 <= size; i += 4) {
                long value = (data[i] & 255L) | ((data[i + 1] & 255L) << 8) | ((data[i + 2] & 255L) << 16) | ((data[i + 3] & 255L) << 24);
                value &= 0xffffffffL;
                if (targets.containsKey(value)) colToType.put(block.getStart().getOffset() + i, value);
            }
        }
        Map<Long, Long> vtableToCol = new HashMap<>();
        for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
            if (!block.isInitialized() || block.getSize() > MAX_BLOCK) continue;
            int size = (int) block.getSize();
            byte[] data = new byte[size];
            block.getBytes(block.getStart(), data);
            for (int i = 0; i + 4 <= size; i += 4) {
                long value = (data[i] & 255L) | ((data[i + 1] & 255L) << 8) | ((data[i + 2] & 255L) << 16) | ((data[i + 3] & 255L) << 24);
                value &= 0xffffffffL;
                if (colToType.containsKey(value)) vtableToCol.put(block.getStart().getOffset() + i + 4, value);
            }
        }
        out.println("COLS " + colToType.size() + " VTABLES " + vtableToCol.size());
        List<Long> vtableAddresses = new ArrayList<>(vtableToCol.keySet());
        vtableAddresses.sort(null);
        for (Long vtable : vtableAddresses) {
            out.printf("VTABLE %08x %s%n", vtable, targets.get(colToType.get(vtableToCol.get(vtable))));
            for (int index = 0; index < MAX_VTABLE; index++) {
                long slot = vtable + index * 4L;
                long value;
                try { value = getInt(toAddr(slot)) & 0xffffffffL; } catch (Exception error) { break; }
                if (value == 0) break;
                Address target = toAddr(value);
                MemoryBlock code = currentProgram.getMemory().getBlock(target);
                if (code == null || !code.isExecute()) break;
                Function function = getFunctionAt(target);
                out.printf("  +%02x %08x %s%n", index * 4, value, function == null ? "FUN_" + Long.toHexString(value) : function.getName());
            }
        }
    }
}
