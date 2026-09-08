import { at, resolveNode, value } from "../src/assets/image.js";

const MAX_METADATA_NODES = 100000;

/** Preserve original rectangle-bearing nodes, including non-attack rectangles.
 * This is metadata extraction, not a skill classification or activation policy.
 * @param {import('../src/assets/image.js').WzNode} root
 * @param {string} source Original archive:IMG path, used as provenance.
 */
export function readHitboxMetadata(root, source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("Original hitbox metadata source is required");
  }
  const queue = [{ node: root, path: source }];
  const rectangles = [];
  const visited = new Set();
  for (let index = 0; index < queue.length; index++) {
    const { node, path } = queue[index];
    if (visited.has(node)) throw new Error(`Cyclic metadata tree: ${path}`);
    visited.add(node);
    const keys = Object.keys(node.children);
    if (queue.length + keys.length > MAX_METADATA_NODES) {
      throw new Error(`Hitbox metadata exceeds ${MAX_METADATA_NODES} nodes`);
    }
    const lt = node.children.lt;
    const rb = node.children.rb;
    if (lt || rb) rectangles.push(readRectangle(node, path));
    for (const name of keys) {
      queue.push({ node: node.children[name], path: `${path}/${name}` });
    }
  }
  return { schemaVersion: 1, source, nodes: queue.length, rectangles };
}

/** @param {{x:number,y:number}|undefined} point */
function validRectanglePoint(point) {
  return point && Number.isInteger(point.x) && Number.isInteger(point.y);
}

/** Extract one explicit lt/rb pair; never derive it from canvas pixels.
 * @param {import('../src/assets/image.js').WzNode} node @param {string} source */
export function readRectangle(node, source) {
  node = resolveNode(node);
  const lt = node.children.lt && resolveNode(node.children.lt).value;
  const rb = node.children.rb && resolveNode(node.children.rb).value;
  if (
    !validRectanglePoint(lt) ||
    !validRectanglePoint(rb) ||
    lt.x > rb.x ||
    lt.y > rb.y
  ) {
    throw new Error(`Invalid original lt/rb rectangle: ${source}`);
  }
  const properties = Object.create(null);
  const keys = Object.keys(node.children);
  if (keys.length > MAX_METADATA_NODES) {
    throw new Error("Metadata property limit");
  }
  for (const name of keys) {
    const child = resolveNode(node.children[name]);
    if (child.value !== undefined) properties[name] = child.value;
  }
  return {
    source,
    left: lt.x,
    top: lt.y,
    right: rb.x,
    bottom: rb.y,
    properties,
  };
}

/** Append the sorted original sword afterimage actions without classifying phases.
 * @param {object[]} references
 * @param {(archive:string,path:string)=>import('../src/assets/image.js').WzNode} image */
function appendAfterimageReferences(references, image) {
  const afterimage = image("Character", "Afterimage/swordOS.img");
  const actions = Object.keys(at(afterimage, "0").children).sort();
  if (actions.length > 64) throw new Error("Reference afterimage action limit");
  for (const action of actions) {
    const node = at(afterimage, `0/${action}`);
    if (!node.children.lt && !node.children.rb) continue;
    const rectangle = readRectangle(
      node,
      `Character.wz:Afterimage/swordOS.img/0/${action}`,
    );
    references.push({
      id: `swordOS-0-${action}`,
      label: `Sword OS / 0 / ${action}`,
      context: { attack: { kind: "afterimage", rectangle } },
    });
  }
}

/** A small reproducible inspection selection, not the equipped avatar's attacks.
 * @param {(archive:string,path:string)=>import('../src/assets/image.js').WzNode} image */
export function extractHitboxReferences(image) {
  const references = [];
  appendAfterimageReferences(references, image);
  const skill = image("Skill", "310.img");
  references.push({
    id: "skill-3101005-level-1",
    label: "Skill 3101005 / level 1 / area",
    context: {
      attack: {
        kind: "skill-area",
        rectangle: readRectangle(
          at(skill, "skill/3101005/level/1"),
          "Skill.wz:310.img/skill/3101005/level/1",
        ),
      },
    },
  });
  appendMobReferences(references, image);
  appendMorphReferences(references, image);
  return {
    schemaVersion: 1,
    mode: "original-geometry-preview",
    activationKnown: false,
    damageOrigin: "explicit-preview-world-origin",
    references,
    unsupported: [
      "automatic-equipment-and-variant-selection",
      "skill-specific-range-modifiers",
      "hit-phase-and-damage-eligibility",
      "ranged-projectile-trajectories",
      "mob-attack-types-1-2-3-4",
      "mount-frame-composition-and-anchor-selection",
    ],
  };
}

/** Append explicit frame-local morph receivers, independent of ordinary pose.
 * @param {object[]} references
 * @param {(archive:string,path:string)=>import('../src/assets/image.js').WzNode} image */
function appendMorphReferences(references, image) {
  const morph = image("Morph", "0001.img");
  for (let frame = 0; frame < 2; frame++) {
    references.push({
      id: `morph-0001-walk-${frame}`,
      label: `Morph 0001 / walk / ${frame}`,
      context: {
        body: {
          kind: "morph",
          rectangle: readRectangle(
            at(morph, `walk/${frame}`),
            `Morph.wz:0001.img/walk/${frame}`,
          ),
        },
      },
    });
  }
}

/** Incoming descriptors use origin (0,0), facing left. Inspector may explicitly
 * replace x/y/facing to place this independent reference actor in its viewport.
 * @param {object[]} references
 * @param {(archive:string,path:string)=>import('../src/assets/image.js').WzNode} image */
function appendMobReferences(references, image) {
  const mob = image("Mob", "9500332.img");
  for (const attack of ["attack1", "attack3"]) {
    const info = at(mob, `${attack}/info`);
    const attackType = value(info, "type");
    if (attackType !== 0) {
      throw new Error("Reference mob attack is not rectangle type 0");
    }
    references.push({
      id: `mob-9500332-${attack}`,
      label: `Mob 9500332 / ${attack} / type 0`,
      context: {
        damage: {
          kind: "mob-attack",
          attackType,
          x: 0,
          y: 0,
          facing: -1,
          rectangle: readRectangle(
            at(info, "range"),
            `Mob.wz:9500332.img/${attack}/info/range`,
          ),
        },
      },
      originalTiming: {
        attackAfter: value(info, "attackAfter"),
        effectAfter: value(info, "effectAfter"),
      },
    });
  }
  const snail = image("Mob", "0100101.img");
  for (let frame = 0; frame < 2; frame++) {
    references.push({
      id: `mob-0100101-move-${frame}`,
      label: `Mob 0100101 / move / ${frame} / body`,
      context: {
        damage: {
          kind: "mob-contact",
          x: 0,
          y: 0,
          facing: -1,
          rectangle: readRectangle(
            at(snail, `move/${frame}`),
            `Mob.wz:0100101.img/move/${frame}`,
          ),
        },
      },
    });
  }
}
