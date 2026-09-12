import { EntityAnimation } from "../rendering/animation.js";

const COMBO_IDS = Object.freeze([1111002, 11111001]);
const ADVANCED_IDS = Object.freeze([1120003, 11110005]);
const DESTROY_DISPLAY = Object.freeze({ children: true });
// Original0093cdbc: negative2000ms parent period,40px radius/centerY-40;
// VA00b3d100 contains1.2566368, not a newly rounded2*pi/5 approximation.
const PERIOD = 2000;
const SPACING = 1.2566368;

/** Original state/%d canvases are individual sprites, not one cycling state animation. */
export class SkillComboPresentation {
  constructor(system) {
    this.system = system;
    this.slots = [];
    this.clock = 0;
    this.previous = 0;
    this.cosine = 1;
    this.sine = 0;
    this.started = false;
  }

  async prepare(skills) {
    this.destroy();
    if (!skills.some((skill) => COMBO_IDS.includes(skill.id))) return;
    await this.prepareSource(1111002, false);
    if (ADVANCED_IDS.some((id) => this.system.level(id) > 0)) {
      await this.prepareSource(1120003, true);
    }
  }

  async prepareSource(id, advanced) {
    const skill = this.system.catalog[id];
    const sequence = await this.system.resources.acquireSequence(
      skill,
      "state",
      0,
    );
    const frames = sequence.owner.manifest.entities[0].actions.play;
    for (let index = 0; index < 6; index++) {
      const number = index === 0 ? 0 : index + (advanced ? 5 : 0);
      const frameIndex = index === 0 ? 0 : Math.trunc((number + 1) / 2);
      const frame = frames[frameIndex];
      const info = skill.properties.state[frameIndex];
      if (!frame || !info) {
        throw new Error("Missing original combo state canvas");
      }
      const animation = new EntityAnimation(
        {
          id: `combo:${id}:${index}`,
          kind: "effect",
          order: index,
          x: 0,
          y: 0,
          z: 0,
          visible: false,
          action: "play",
          actions: { play: [frame] },
        },
        sequence.owner.textures,
      );
      this.system.scene.overlays.addChild(animation.container);
      this.slots.push({
        animation,
        advanced,
        number,
        age: 0,
        visible: false,
        fade: 0,
        fadeDuration: 0,
        duration: frame.delay,
        baseX: number ? Math.trunc(Math.cos(number * SPACING) * 40) : 0,
        baseY: number ? Math.trunc(Math.sin(number * SPACING) * 40) : 0,
        zoomStart: (info.z0 ?? 100) / 100,
        zoomEnd: (info.z1 ?? 100) / 100,
      });
    }
  }

  present(ms) {
    let count = 0;
    for (const id of COMBO_IDS) {
      if (this.system.states.get(id)?.remaining > 0) {
        this.started = true;
        count = Math.max(0, Math.min(10, this.system.derived().combo - 1));
      }
    }
    if (this.started) this.clock = (this.clock + ms) % PERIOD;
    const angle = (-this.clock * Math.PI * 2) / PERIOD;
    this.cosine = Math.cos(angle);
    this.sine = Math.sin(angle);
    for (const slot of this.slots) this.updateSlot(slot, count, ms);
    this.previous = count;
  }

  updateSlot(slot, count, ms) {
    const wanted = comboSlotWanted(slot, count);
    if (wanted && !slot.visible) slot.age = 0;
    if (!count && this.previous > 0 && slot.visible) {
      slot.fadeDuration = 200 + (slot.number % 6) * 60;
      slot.fade = slot.fadeDuration;
    }
    if (wanted) slot.fade = 0;
    slot.visible = wanted;
    slot.fade = Math.max(0, slot.fade - ms);
    slot.animation.container.visible = wanted || slot.fade > 0;
    if (!slot.animation.container.visible) return;
    slot.age += ms;
    slot.animation.setAction("play", "once");
    slot.animation.seek(slot.age);
    const t = slot.duration ? Math.min(1, slot.age / slot.duration) : 1;
    const zoom = slot.zoomStart + (slot.zoomEnd - slot.zoomStart) * t;
    slot.animation.container.scale.set(zoom, zoom);
    slot.animation.container.alpha = wanted ? 1 : slot.fade / slot.fadeDuration;
    this.position(slot);
  }

  position(slot) {
    const scene = this.system.scene;
    const rawX = slot.baseX * this.cosine - slot.baseY * this.sine;
    const rawY = slot.baseX * this.sine + slot.baseY * this.cosine;
    const x = Math.trunc(rawX + (rawX >= 0 ? 0.5 : -0.499999999));
    const y = Math.trunc(rawY + (rawY >= 0 ? 0.5 : -0.499999999));
    slot.animation.setPosition(
      scene.presentation.x + x,
      scene.presentation.y - 40 + y,
    );
    slot.animation.container.zIndex = scene.actor.container.zIndex;
  }

  destroy() {
    for (const slot of this.slots) {
      slot.animation.container.destroy(DESTROY_DISPLAY);
    }
    this.slots.length = 0;
  }
}

function comboSlotWanted(slot, count) {
  return slot.number === 0
    ? count > 0 && slot.advanced === count > 5
    : slot.number <= count && slot.number + 5 > count;
}
