import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { composeRiding } from "./skill-riding-composition.js";
import { RIDING_SKILLS } from "./skill-world-rules.js";

const DESTROY = Object.freeze({ children: true });
const FATIGUE_MS = 60000; // Authorized Cosmic MOUNT_EXHAUST_COUNT=1, one scheduler proc/minute.

function equipped(profile, slot) {
  for (const item of profile.equipment) if (item.slot === slot) return item.id;
  return null;
}

export class SkillRiding {
  constructor(system) {
    this.system = system;
    this.records = new Map();
    this.current = null;
    this.controller = new AbortController();
    this.shipHP = 0;
    this.fatigueMs = 0;
  }

  async prepare(skills) {
    for (const skill of skills) {
      if (!RIDING_SKILLS.has(skill.id)) continue;
      const id =
        skill.id === 5221006
          ? 1932000
          : equipped(this.system.store.profile, -18);
      if (!id) continue;
      const prior = this.records.get(id);
      if (prior?.actor === this.system.scene.actor) continue;
      if (prior) {
        if (this.current === prior) this.cancel();
        this.release(prior);
        this.records.delete(id);
      }
      await this.prepareMount(id);
    }
  }

  async prepareMount(id) {
    const catalog = this.system.fullCatalog.ui.skillWorld?.riding;
    const descriptor = catalog?.mounts[id];
    if (!descriptor || descriptor.templateId === null) return;
    const saddleId =
      id === 1932000 ? null : equipped(this.system.store.profile, -19);
    const saddleDescriptor = saddleId ? catalog.saddles[saddleId]?.[id] : null;
    if (id !== 1932000 && !saddleDescriptor) return;
    await this.loadMount(
      {
        id,
        saddleId,
        descriptor,
        owner: null,
        saddleOwner: null,
        anchor: catalog.riderAnchor,
      },
      saddleDescriptor,
    );
  }

  async loadMount(input, saddleDescriptor) {
    const owner = await loadVisualBundle(
      input.descriptor.bundle,
      this.system.hooks.services,
      this.controller.signal,
    );
    let saddleOwner = null;
    try {
      if (saddleDescriptor) {
        saddleOwner = await loadVisualBundle(
          saddleDescriptor.bundle,
          this.system.hooks.services,
          this.controller.signal,
        );
      }
      input.owner = owner;
      input.saddleOwner = saddleOwner;
      this.finishPreparation(input);
    } catch (error) {
      owner.destroy();
      saddleOwner?.destroy();
      throw error;
    }
  }

  finishPreparation(input) {
    const actor = this.system.scene.actor;
    const rider = this.system.scene.avatarOwner?.resource.entity;
    if (!rider) {
      throw new Error("Riding requires the current profile avatar resource");
    }
    const entity = composeRiding(
      input.owner.manifest.metadata.riding,
      input.saddleOwner?.manifest.metadata.riding,
      rider,
      input.anchor,
    );
    const textures = new Map(actor.textures);
    for (const [id, texture] of input.owner.textures) textures.set(id, texture);
    for (const [id, texture] of input.saddleOwner?.textures ?? []) {
      textures.set(id, texture);
    }
    const animation = new EntityAnimation(entity, textures);
    animation.container.visible = false;
    this.system.scene.addWorldContainer(
      animation.container,
      actor.container.zIndex,
    );
    this.records.set(input.id, {
      ...input,
      animation,
      actor,
      remainingMs: 0,
      skillId: 0,
      info: null,
    });
  }

  admissionError(skill) {
    const profile = this.system.store.profile;
    const ship = skill.id === 5221006;
    const id = ship ? 1932000 : equipped(profile, -18);
    const record = this.records.get(id);
    const resourceError = this.mountAdmission(record, ship);
    if (resourceError) return resourceError;
    if (ship && this.system.states.get(5221006).cooldown > 0) {
      return "Battleship is recovering from destruction";
    }
    if ((this.system.scene.manifest.physics.map.fieldLimit ?? 0) & 0x200) {
      return "Riding is forbidden in this field";
    }
    if (this.system.scene.simulation.state !== "ground") {
      return "Riding requires ground";
    }
    return null;
  }

  mountAdmission(record, ship) {
    const profile = this.system.store.profile;
    if (!record || record.actor !== this.system.scene.actor) {
      return "Original equipped mount and matching saddle resources are not prepared";
    }
    if (record.descriptor.templateId === null) {
      return "Original mount movement template is unavailable";
    }
    if (!ship && equipped(profile, -19) !== record.saddleId) {
      return "The saddle does not match the prepared mount";
    }
    if (!ship && (!profile.mount || profile.mount.tiredness >= 99)) {
      return "The mount is exhausted or its original fatigue state is unavailable";
    }
    return null;
  }

  cast(skill, info, rank, restoring = false) {
    if (this.current?.skillId === skill.id) {
      this.cancel();
      return;
    }
    this.cancel();
    const id =
      skill.id === 5221006 ? 1932000 : equipped(this.system.store.profile, -18);
    const record = this.records.get(id);
    record.skillId = skill.id;
    record.info = info;
    record.remainingMs = info.time * 1000;
    this.current = record;
    if (skill.id === 5221006 && this.shipHP <= 0) {
      this.shipHP =
        400 * rank + Math.max(this.system.store.profile.level - 120, 0) * 200;
    }
    this.system.scene.actor.container.renderable = false;
    this.system.scene.simulation.worldMovement.form = record.descriptor;
    record.animation.container.visible = true;
    if (!restoring) this.system.startBuff(skill, rank, info);
  }

  damage(amount) {
    if (this.current?.skillId !== 5221006) return;
    this.shipHP = Math.max(0, this.shipHP - amount);
    if (this.shipHP > 0) return;
    this.system.states.get(5221006).cooldown =
      this.current.info.cooltime * 1000;
    this.cancel();
  }

  step(ms) {
    const record = this.current;
    if (!record) return;
    record.remainingMs = Math.max(0, record.remainingMs - ms);
    if (
      !record.remainingMs ||
      record.actor !== this.system.scene.actor ||
      this.system.level(record.skillId) <= 0
    ) {
      this.cancel();
      return;
    }
    this.present(this.system.scene.simulation);
    record.animation.advance(ms);
    if (record.skillId === 5221006) return;
    this.fatigueMs += ms;
    if (this.fatigueMs < FATIGUE_MS) return;
    const ticks = Math.trunc(this.fatigueMs / FATIGUE_MS);
    this.fatigueMs %= FATIGUE_MS;
    const mount = this.system.store.profile.mount;
    mount.tiredness = Math.min(99, mount.tiredness + ticks);
    this.system.store.markDirty();
    if (mount.tiredness >= 99) this.cancel();
  }

  present(pose) {
    const record = this.current;
    if (!record) return;
    const action = pose.action ?? this.system.scene.simulation.action;
    if (record.animation.actions.has(action)) {
      record.animation.setAction(action, pose.playback ?? "loop");
    }
    record.animation.setPosition(pose.x, pose.y);

    record.animation.container.scale.x = pose.facing > 0 ? -1 : 1;
  }
  release(record) {
    this.system.scene.removeWorldContainer(record.animation.container);
    record.animation.container.destroy(DESTROY);
    record.owner.destroy();
    record.saddleOwner?.destroy();
  }

  cancel() {
    if (!this.current) return;
    this.current.animation.container.visible = false;
    this.system.scene.actor.container.renderable = true;
    this.system.scene.simulation.worldMovement.form = null;
    if (!this.system.transferredEffects) {
      this.system.effects.remove(this.current.skillId);
    }
    this.system.recompute();
    this.current = null;
  }

  destroy() {
    this.cancel();
    this.controller.abort();
    for (const record of this.records.values()) this.release(record);
    this.records.clear();
  }
}
