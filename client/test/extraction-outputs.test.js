import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractionOutputs } from "../tools/extraction-outputs.js";
import { resource } from "../tools/atlas.js";

async function workspace(run) {
  const root = await mkdtemp(join(tmpdir(), "openms-output-verification-"));
  const output = join(root, "generated");
  try {
    await mkdir(join(output, "references"), { recursive: true });
    await run({ root, output });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("verification follows inline and transitive descriptors and hashes shared files only once per run", async () => {
  await workspace(async ({ output }) => {
    const leaf = await resource(
      output,
      "references",
      "bin",
      Buffer.from("pixels"),
    );
    const parent = await resource(
      output,
      "references",
      "json",
      Buffer.from(JSON.stringify({ child: leaf })),
    );
    const verifier = extractionOutputs(output);
    const closure = await verifier.closure({ parent, shared: leaf });
    expect(closure).toHaveLength(2);
    expect(await verifier.closure(parent)).toEqual(closure);
    expect(verifier.stats.resources).toBe(2);
    expect(verifier.stats.bytes).toBe(leaf.bytes + parent.bytes);
    const path = join(output, leaf.url.slice(11));
    await Bun.write(path, "PIXELS");
    await expect(extractionOutputs(output).closure(parent)).rejects.toThrow(
      "SHA-256",
    );
    await rm(path);
    await expect(extractionOutputs(output).closure(parent)).rejects.toThrow();
  });
});

test("correctly hashed output cannot escape through symlinks or hide conflicting JSON children", async () => {
  await workspace(async ({ root, output }) => {
    const leaf = await resource(
      output,
      "references",
      "bin",
      Buffer.from("data"),
    );
    const path = join(output, leaf.url.slice(11));
    const external = join(root, "outside.bin");
    await Bun.write(external, "data");
    await rm(path);
    await symlink(external, path);
    await expect(extractionOutputs(output).closure(leaf)).rejects.toThrow(
      "escapes",
    );
    await rm(path);
    await Bun.write(path, "data");
    const parent = await resource(
      output,
      "references",
      "json",
      Buffer.from(
        JSON.stringify({ first: leaf, second: { ...leaf, bytes: 3 } }),
      ),
    );
    await expect(extractionOutputs(output).closure(parent)).rejects.toThrow(
      "Conflicting",
    );
    const malformed = await resource(
      output,
      "references",
      "json",
      Buffer.from("{invalid json"),
    );
    await expect(
      extractionOutputs(output).closure(malformed),
    ).rejects.toThrow();
  });
});
