import { Container, Sprite } from "pixi.js";
import { loadVisualBundle } from "./visual-resources.js";
import { check } from "./stream-network.js";

const MAX_NUMBERS = 64;
const MAX_DIGITS = 10;
const FAMILIES = ["NoRed", "NoBlue", "NoViolet", "NoCri"];
const DESTROY = Object.freeze({ children: true });

/** Original 00437d0f: 400 ms opaque, 600 ms fade, -30 px over 1000 ms. */
export class CombatPresentation {
  constructor(app, services) {
    this.app = app;
    this.services = services;
    this.scene = null;
    this.owner = null;
    this.glyphs = null;
    this.slots = [];
    this.next = 0;
    this.emitted = 0;
    this.overflow = 0;
    this.destroyed = false;
    for (let i = 0; i < MAX_NUMBERS; i++) {
      const container = new Container();
      container.visible = false;
      const sprites = [];
      for (let digit = 0; digit < MAX_DIGITS; digit++) {
        const sprite = new Sprite();
        container.addChild(sprite);
        sprites.push(sprite);
      }
      this.slots.push({ container, sprites, age: 1000, x: 0, y: 0 });
    }
  }
  async prepare(catalog, signal) {
    if (this.destroyed || this.owner) {
      throw new Error("Combat presentation is not a fresh owner");
    }
    if (!catalog?.combat?.digits) {
      throw new Error("Missing original combat digit catalog");
    }
    const owner = await loadVisualBundle(
      catalog.combat.digits,
      this.services,
      signal,
    );
    try {
      check(signal);
      if (this.destroyed) throw new Error("Combat presentation was destroyed");
      this.glyphs = readGlyphs(owner);
      this.owner = owner;
    } catch (error) {
      owner.destroy();
      throw error;
    }
  }
  setScene(scene) {
    for (const slot of this.slots) {
      this.scene?.removeWorldContainer(slot.container);
      slot.age = 1000;
      slot.container.visible = false;
    }
    this.scene = scene;
  }
  onPlayerHit(hit, simulation) {
    if (hit.amount < 0) return;
    // 00959320..b9 subtracts damage before the signed vital-number consumer.
    this.onVitalNumber(-(hit.hpDamage ?? hit.amount), simulation);
  }

  onRecovery(amount, simulation) {
    this.onVitalNumber(amount, simulation);
  }

  onVitalNumber(amount, simulation) {
    const actor = this.scene?.actor;
    const geometry = actor?.actions.get(actor.action)?.geometry[actor.frame];
    // Browser binding-extent approximation; native 004519aa queries two layers.
    const y = simulation.y + (geometry?.y ?? 0);
    this.show(Math.abs(amount), amount > 0 ? 1 : 2, simulation.x, y);
  }
  onMobHit(mob, damage) {
    const entity = mob.presentation;
    const geometry = entity?.actions.get(entity.action)?.geometry[entity.frame];
    const y = mob.y + (geometry?.y ?? 0) - 15;
    this.show(Math.abs(damage), damage < 0 ? 1 : 0, mob.x, y);
  }
  /** Coordinates are fixed world anchors, not reattached to a moving target. */
  show(amount, family, x, y) {
    if (
      !this.owner ||
      !this.scene ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > 9999999999
    ) {
      return;
    }
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % MAX_NUMBERS;
    if (slot.age < 1000) this.overflow++;
    slot.age = 0;
    slot.x = x;
    slot.y = y;
    slot.container.visible = true;
    slot.container.alpha = 1;
    this.layoutDigits(slot, amount, family);
    // 0043849c/0043dee8: each numeric event is its own native root layer.
    this.scene.addWorldContainer(slot.container, 398500);
    this.emitted++;
  }
  layoutDigits(slot, amount, family) {
    let divisor = 1;
    while (divisor <= amount / 10) divisor *= 10;
    let width = 0,
      overlap = 0,
      count = 0;
    do {
      const digit = amount === 0 ? 10 : Math.trunc(amount / divisor) % 10;
      const glyph =
        this.glyphs[family][count === 0 && amount > 0 ? 1 : 0][digit];
      const sprite = slot.sprites[count];
      sprite.texture = glyph.texture;
      sprite.visible = true;
      sprite.x = width - overlap;
      sprite.y = 47 + glyph.y;
      width = sprite.x + glyph.width;
      overlap = Math.trunc(((glyph.width + glyph.x) * 3) / 5);
      divisor = Math.trunc(divisor / 10);
      count++;
    } while (divisor > 0 && count < MAX_DIGITS);
    for (let i = count; i < MAX_DIGITS; i++) slot.sprites[i].visible = false;
    slot.x -= Math.trunc(width / 2);
    slot.y -= 47;
    slot.container.position.set(slot.x, slot.y);
  }
  update(ms) {
    for (const slot of this.slots) {
      if (slot.age >= 1000) continue;
      slot.age = Math.min(1000, slot.age + ms);
      slot.container.visible = slot.age < 1000;
      if (slot.age === 1000) this.scene?.removeWorldContainer(slot.container);
      slot.container.y = slot.y - (30 * slot.age) / 1000;
      slot.container.alpha = slot.age <= 400 ? 1 : (1000 - slot.age) / 600;
    }
  }
  snapshot() {
    let active = 0;
    for (const slot of this.slots) if (slot.age < 1000) active++;
    return {
      active,
      emitted: this.emitted,
      overflow: this.overflow,
      capacity: MAX_NUMBERS,
    };
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const slot of this.slots) {
      this.scene?.removeWorldContainer(slot.container);
      slot.container.destroy(DESTROY);
    }
    this.scene = null;
    this.owner?.destroy();
    this.owner = null;
    this.glyphs = null;
  }
}

function readGlyphs(owner) {
  const families = [];
  const actions = owner.manifest.entities[0].actions;
  for (const family of FAMILIES) {
    const variants = [];
    for (let variant = 0; variant < 2; variant++) {
      variants.push(readVariant(actions, owner.textures, family, variant));
    }
    families.push(variants);
  }
  return families;
}

function readVariant(actions, textures, family, variant) {
  const glyphs = [];
  const requiresMiss =
    variant === 0 && (family === "NoRed" || family === "NoViolet");
  for (let digit = 0; digit <= 10; digit++) {
    const key = `${family}${variant}/${digit === 10 ? "Miss" : digit}`;
    const frame = actions[key]?.[0];
    if (!frame) {
      if (digit < 10 || requiresMiss) {
        throw new Error(`Missing original combat glyph: ${key}`);
      }
      glyphs.push(null);
      continue;
    }
    if (frame.parts.length !== 1) {
      throw new Error("Combat glyph must be one original canvas");
    }
    const part = frame.parts[0];
    const texture = textures.get(part.texture);
    glyphs.push({ texture, x: part.x, y: part.y, width: texture.width });
  }
  return glyphs;
}
