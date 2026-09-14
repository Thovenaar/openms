import { MAX_MESO_PILES } from "./skill-target-rules.js";
import { currencyVariant } from "../world/drop-artwork.js";
import { loadSkillVisual } from "./skill-runtime-ports.js";

// Native00504cd1..00504d77: drop landing point, no parent vector, random hit variant.
// See docs/ghidra-client-corrections/meso-animation-instructions.txt.
const PATHS = Object.freeze([
  "hit/0",
  "hit/1",
  "hit/2",
  "hit/3",
  "hit/4",
  "hit/5",
  "hit/6",
  "hit/7",
  "hit/8",
]);
const OPTIONS = Object.freeze({ follow: false, loop: false, facing: -1 });

/** Each consumed pile owns an explosion, including casts that hit no monsters. */
export class SkillMesoPresentation {
  constructor(resources, random = Math.random) {
    this.resources = resources;
    this.random = random;
    this.sequences = new Array(PATHS.length).fill(null);
    this.position = { x: 0, y: 0 };
    this.halfHeights = null;
  }

  async prepare(skill, artwork) {
    if (!this.halfHeights) await this.prepareHeights(artwork);
    for (let index = 0; index < PATHS.length; index++) {
      this.sequences[index] = await this.resources.acquireSequence(
        skill,
        PATHS[index],
        MAX_MESO_PILES,
      );
    }
  }

  /** Native00505f39..00505f5a stores landing Y minus half the initial meso canvas. */
  async prepareHeights(artwork) {
    const owner = await loadSkillVisual(
      this.resources,
      artwork.descriptor,
      this.resources.controller.signal,
    );
    try {
      const heights = new Int16Array(4);
      for (let variant = 0; variant < heights.length; variant++) {
        const path = artwork.variants[variant][0].path;
        const height = owner.manifest.metadata.assets[path]?.height;
        if (!Number.isSafeInteger(height) || height < 1 || height > 32767) {
          throw new Error("Original meso canvas height is unavailable");
        }
        heights[variant] = Math.trunc(height / 2);
      }
      this.halfHeights = heights;
    } finally {
      owner.destroy();
    }
  }

  admissionError(count) {
    for (const sequence of this.sequences) {
      if (!sequence) return "Meso Explosion artwork is not prepared";
      // Any admitted batch may randomly choose the same variant for every pile.
      if (!this.resources.hasSlots(sequence, count)) {
        return "Meso Explosion visual slots are busy";
      }
    }
    return null;
  }

  /** The saved centered landing vector excludes the drop's current idle bob. */
  play(skill, piles, count) {
    for (let index = 0; index < count; index++) {
      const variant = Math.floor(this.random() * PATHS.length);
      const pile = piles[index];
      this.position.x = pile.groundX;
      this.position.y =
        pile.groundY - this.halfHeights[currencyVariant(pile.quantity)];
      const slot = this.resources.playSequence(
        this.sequences[variant],
        this.position,
        OPTIONS,
      );
      if (!slot) throw new Error("Admitted Meso Explosion visual unavailable");
      slot.target = null;
    }
    // Native00504d0d throttles Hit to once per90ms; simultaneous piles share a voice.
    this.resources.sound(skill, "Hit");
  }
}
