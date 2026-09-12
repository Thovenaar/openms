import { expect, test } from "bun:test";
import { StreamScene } from "../src/rendering/stream-scene.js";

function descriptor(id, x) {
  return {
    id,
    always: false,
    bounds: { left: x, top: 0, right: x + 800, bottom: 600 },
  };
}

function sceneFixture(network) {
  return new StreamScene(
    {
      camera: { x: 0, y: 0 },
      regions: [
        descriptor("departure", 0),
        descriptor("middle", 2500),
        descriptor("arrival", 6000),
      ],
      textures: {},
      atlases: {},
    },
    { network, atlases: null },
    { width: 800, height: 600 },
  );
}

test("same-map staging survives ordinary demand and retains the smooth camera corridor until arrival", async () => {
  const admitted = Promise.withResolvers();
  const release = Promise.withResolvers();
  const scene = sceneFixture({
    async json(region) {
      if (region.id === "middle") {
        admitted.resolve();
        await release.promise;
      }
      return { schemaVersion: 2, id: region.id, entities: [] };
    },
  });
  try {
    await scene.loadRegion(scene.manifest.regions[0]);
    const staging = scene.prepareCameraPath(
      { x: 6000, y: 0 },
      new AbortController().signal,
    );
    await admitted.promise;
    scene.updateDemand();
    expect(scene.regions.get("middle").controller.signal.aborted).toBe(false);
    expect(scene.regions.has("arrival")).toBe(false);
    release.resolve();
    const path = await staging;
    expect(scene.regions.get("arrival").ready).toBe(true);
    path.committed = true;
    scene.camera.x = 3000;
    scene.updateDemand();
    expect(scene.regions.get("departure").ready).toBe(true);
    expect(scene.regions.get("arrival").ready).toBe(true);
    scene.camera.x = 6000;
    scene.updateDemand();
    expect(scene.regions.has("departure")).toBe(false);
    expect(scene.regions.has("middle")).toBe(false);
    expect(scene.regions.get("arrival").ready).toBe(true);
  } finally {
    release.resolve();
    scene.destroy();
  }
});

test("failed camera-path replacement leaves the old region resident and clears its staging pin", async () => {
  const scene = sceneFixture({
    async json(region) {
      if (region.id === "middle") {
        throw new Error("Unavailable original region");
      }
      return { schemaVersion: 2, id: region.id, entities: [] };
    },
  });
  try {
    await scene.loadRegion(scene.manifest.regions[0]);
    await expect(
      scene.prepareCameraPath({ x: 6000, y: 0 }, new AbortController().signal),
    ).rejects.toThrow("Unavailable original region");
    expect(scene.camera).toEqual({ x: 0, y: 0 });
    expect(scene.cameraPath).toBeNull();
    expect(scene.regions.get("departure").ready).toBe(true);
  } finally {
    scene.destroy();
  }
});
