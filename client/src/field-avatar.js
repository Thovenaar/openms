import { EntityAnimation } from "./animation.js";

/** All composition, textures and sprite allocation precede inventory/profile publication. */
export async function prepareFieldAvatar(visuals, profile, source, signal) {
  const resource = await visuals.prepare(profile, { entity: source, signal });
  let animation = null;
  try {
    signal?.throwIfAborted();
    animation = new EntityAnimation(resource.entity, resource.textures);
    animation.avatar = resource.entity.avatar;
    let destroyed = false;
    return {
      animation,
      resource,
      scene: null,
      previous: null,
      attachments: null,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (!animation.container.destroyed) {
          animation.container.destroy({ children: true });
        }
        resource.destroy();
      },
    };
  } catch (error) {
    animation?.container.destroy({ children: true });
    resource.destroy();
    throw error;
  }
}

/** Check the exact old display membership while the item operation still owns no durable debit. */
export function admitAvatarReplacement(scene, prepared) {
  const previous = scene.actor;
  const regionIndex = scene.actorRegion.entities.indexOf(previous);
  const entityIndex = scene.entities.indexOf(previous);
  const displayIndex = scene.container.children.indexOf(previous.container);
  if (
    scene.destroyed ||
    regionIndex < 0 ||
    entityIndex < 0 ||
    displayIndex < 0 ||
    prepared.animation.id !== previous.id ||
    prepared.animation.kind !== "character"
  ) {
    throw new Error(
      "The prepared avatar does not replace the current field actor",
    );
  }
  prepared.scene = scene;
  prepared.previous = previous;
  prepared.regionIndex = regionIndex;
  prepared.entityIndex = entityIndex;
  prepared.displayIndex = displayIndex;
  prepared.attachments = [];
  for (const container of scene.presentationContainers) {
    if (container.parent === previous.container) {
      prepared.attachments.push(container);
    }
  }
  const next = prepared.animation;
  next.container.zIndex = previous.container.zIndex;
  next.container.depthOrder = previous.container.depthOrder;
  next.container.visible = previous.container.visible;
  next.container.scale.x = previous.container.scale.x;
  next.setPosition(previous.baseX, previous.baseY);
}

/** Existing entries are replaced in place; no resource loading, composition, or observer callbacks. */
export function publishFieldAvatar(prepared) {
  const scene = prepared.scene,
    previous = prepared.previous,
    next = prepared.animation;
  const oldOwner = scene.avatarOwner;
  scene.actorRegion.entities[prepared.regionIndex] = next;
  scene.entities[prepared.entityIndex] = next;
  scene.byId.set(next.id, next);
  scene.spriteCount += next.sprites.length - previous.sprites.length;
  scene.container.removeChild(previous.container);
  scene.container.addChildAt(next.container, prepared.displayIndex);
  scene.actor = next;
  scene.avatarOwner = prepared;
  // Registered presentation children are borrowed, not owned by the replaceable sprite body.
  for (const container of prepared.attachments) {
    next.container.addChild(container);
  }
  prepared.attachments.length = 0;
  previous.container.destroy({ children: true });
  oldOwner?.destroy();
}
