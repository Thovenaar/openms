import { expect, test } from "bun:test";
import { Container, Texture } from "pixi.js";
import { EntityAnimation } from "../src/rendering/animation.js";
import { MapleTVSystem } from "../src/social/mapletv-system.js";

function screen(id, action) {
  return new EntityAnimation(
    {
      id,
      kind: "effect",
      x: 0,
      y: 0,
      z: 0,
      action,
      actions: {
        [action]: [
          { delay: 150, parts: [{ texture: "pixel", x: 0, y: 0, z: 0 }] },
          { delay: 1000, parts: [{ texture: "pixel", x: 1, y: 0, z: 0 }] },
        ],
      },
    },
    new Map([["pixel", Texture.WHITE]]),
  );
}

function attachScreens(scene, record, allocated) {
  for (const [id, action] of [
    [record.media, "0"],
    [record.message, "TVoff"],
  ]) {
    const entity = screen(id, action);
    allocated.push(entity);
    scene.byId.set(id, entity);
  }
}

test("MapleTV loop and finished idle screen retain their phase across streamed recreation", () => {
  const record = {
    owner: "life:20",
    media: "life:20:mapletv:media",
    message: "life:20:mapletv:message",
    programs: ["0"],
  };
  const owner = {
    record: { id: record.owner },
    template: { info: { MapleTV: 1 } },
    entity: { container: new Container() },
  };
  const scene = {
    manifest: { life: { mapleTV: [record] } },
    byId: new Map(),
  };
  const system = new MapleTVSystem(scene, new Map([[record.owner, owner]]));
  const allocated = [];
  try {
    attachScreens(scene, record, allocated);
    system.refresh();
    for (const entity of scene.byId.values()) entity.advance(150);
    system.update(150);
    expect(scene.byId.get(record.media).sprites[0].x).toBe(1);
    scene.byId.clear();
    system.refresh();
    for (const entity of allocated) {
      entity.container.destroy({ children: true });
    }
    system.update(1150);
    attachScreens(scene, record, allocated);
    system.refresh();
    // At1300ms the looping ad is150ms into its next pass, not reset to frame0.
    expect(scene.byId.get(record.media).sprites[0].x).toBe(1);
    expect(scene.byId.get(record.message).completed).toBe(true);
    for (const entity of scene.byId.values()) entity.advance(1000);
    system.update(1000);
    expect(scene.byId.get(record.media).sprites[0].x).toBe(0);
    expect(scene.byId.get(record.message).sprites[0].x).toBe(1);
    owner.entity.container.visible = false;
    system.update(0);
    expect(scene.byId.get(record.media).container.visible).toBe(false);
    expect(scene.byId.get(record.message).container.visible).toBe(false);
  } finally {
    system.destroy();
    for (const entity of allocated) {
      if (!entity.container.destroyed) {
        entity.container.destroy({ children: true });
      }
    }
    owner.entity.container.destroy();
  }
});
