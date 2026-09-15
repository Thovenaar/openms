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

test("compressible JSON gains a deterministic compressed sibling while other types do not", async () => {
  await workspace(async ({ output }) => {
    for (const directory of ["maps", "regions", "atlases"]) {
      await mkdir(join(output, directory), { recursive: true });
    }
    const large = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        entities: Array.from({ length: 4000 }, (_, index) => ({
          id: `entity-${index}`,
          x: index,
          y: index * 2,
        })),
      }),
    );
    expect(large.length).toBeGreaterThan(64 * 1024);

    const descriptor = await resource(output, "maps", "json", large);
    expect(descriptor.url).toBe(`/generated/maps/${descriptor.sha256}.json`);
    const stored = Bun.file(join(output, `maps/${descriptor.sha256}.json`));
    // The raw resource stays authoritative for verification.
    expect(Buffer.from(await stored.arrayBuffer())).toEqual(large);

    const compressedPath = join(output, `maps/${descriptor.sha256}.json.gz`);
    const compressed = Bun.file(compressedPath);
    expect(await compressed.exists()).toBe(true);
    const bytes = Buffer.from(await compressed.arrayBuffer());
    // Bounded by the raw size, and inflates back to the exact verified payload.
    expect(bytes.length).toBeLessThan(large.length);
    expect(Bun.gunzipSync(bytes)).toEqual(large);

    // Repeated publication reuses identical bytes rather than rewriting them.
    const again = await resource(output, "maps", "json", large);
    expect(again).toEqual(descriptor);

    // Small JSON and already-compressed artwork never gain a sibling.
    const small = await resource(
      output,
      "regions",
      "json",
      Buffer.from(JSON.stringify({ schemaVersion: 2, id: "small" })),
    );
    expect(
      await Bun.file(join(output, `regions/${small.sha256}.json.gz`)).exists(),
    ).toBe(false);
    const png = await resource(
      output,
      "atlases",
      "png",
      Buffer.alloc(70 * 1024, 7),
    );
    expect(
      await Bun.file(join(output, `atlases/${png.sha256}.png.gz`)).exists(),
    ).toBe(false);
  });
});
