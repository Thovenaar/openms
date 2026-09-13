import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";

/** The authority supplies metadata clocks; the native client supplies Pixi leases. */
export function createSkillAnimation(system, entity, textures) {
  return system.hooks.createAnimation
    ? system.hooks.createAnimation(entity, textures)
    : new EntityAnimation(entity, textures);
}

export function loadSkillVisual(system, descriptor, signal) {
  return system.hooks.loadVisual
    ? system.hooks.loadVisual(descriptor, signal)
    : loadVisualBundle(descriptor, system.hooks.services, signal);
}
