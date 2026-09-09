// Export immutable program bytes for original UI tables. Does not modify the program.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import java.io.PrintWriter;

public class clientBytes extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 2) throw new IllegalArgumentException("output address:hexLength,...");
        String[] ranges = args[1].split(",");
        if (ranges.length > 64) throw new IllegalArgumentException("Too many ranges");
        try (PrintWriter output = new PrintWriter(args[0], "UTF-8")) {
            output.println("PROGRAM " + currentProgram.getName());
            for (String range : ranges) exportRange(output, range);
        }
    }

    private void exportRange(PrintWriter output, String range) throws Exception {
        String[] parts = range.split(":");
        if (parts.length != 2) throw new IllegalArgumentException("Expected address:hexLength");
        Address address = toAddr(parts[0]);
        int length = Integer.parseUnsignedInt(parts[1], 16);
        if (length < 1 || length > 65536) throw new IllegalArgumentException("Invalid range length");
        byte[] bytes = new byte[length];
        int count = currentProgram.getMemory().getBytes(address, bytes);
        if (count != length) throw new IllegalStateException("Incomplete range " + range);
        output.println("RANGE " + address + " " + length);
        for (int offset = 0; offset < length; offset += 16) {
            output.print(address.add(offset));
            for (int column = 0; column < 16 && offset + column < length; column++) {
                output.printf(" %02x", bytes[offset + column] & 255);
            }
            output.println();
        }
    }
}
