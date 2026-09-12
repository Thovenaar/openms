import { EntityAnimation } from "../rendering/animation.js";

/** All composition, textures and sprite allocation precede inventory/profile publication. */
export async function prepareFieldAvatar(visuals, profile, source, signal) {
  const resource = await visuals.prepare(profile, { entity: source, signal });
  let animation = null;
  try {
    signal?.throwIfAborted();
    animation = new EntityAnimation(resource.entity, resource.textures);
    let destroyed = false;
    return {
      animation,
      resource,
      scene: null,
      previous: null,
      attachments: null,
      combat: null,
      shadowOwner: null,
      shadow: null,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (this.shadow) {
          this.shadowOwner.discardActor(this.shadow);
          this.shadow = null;
        }
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
  prepareAvatarBindings(scene, prepared);
}

function prepareAvatarBindings(scene, prepared) {
  const systems = scene.fieldSystems;
  if (!systems) return;
  prepared.combat = systems.gameplay.prepareCombatReplacement(
    prepared.animation.avatar.combat,
    prepared.animation,
  );
  prepared.shadowOwner = systems.skills?.stateController.shadow;
  if (prepared.shadowOwner) {
    prepared.shadow = prepared.shadowOwner.prepareActor(prepared.animation);
  }
}

/** Existing entries are replaced in place; no resource loading, composition, or observer callbacks. */
export function publishFieldAvatar(prepared) {
  const scene = prepared.scene,
    previous = prepared.previous,
    next = prepared.animation;
  const oldOwner = scene.avatarOwner;
  scene.fieldSystems?.gameplay?.replaceCombat(
    next.avatar.combat,
    prepared.combat,
  );
  prepared.combat = null;
  scene.actorRegion.entities[prepared.regionIndex] = next;
  scene.entities[prepared.entityIndex] = next;
  scene.byId.set(next.id, next);
  scene.spriteCount += next.sprites.length - previous.sprites.length;
  scene.container.removeChild(previous.container);
  scene.container.addChildAt(next.container, prepared.displayIndex);
  scene.actor = next;
  scene.avatarOwner = prepared;
  if (prepared.shadow) {
    prepared.shadowOwner.publishActor(next, prepared.shadow);
    prepared.shadow = null;
    prepared.shadowOwner = null;
  }
  // Registered presentation children are borrowed, not owned by the replaceable sprite body.
  for (const container of prepared.attachments) {
    next.container.addChild(container);
  }
  prepared.attachments.length = 0;
  previous.container.destroy({ children: true });
  oldOwner?.destroy();
}
