/**
 * Original geometry inspection, not a combat authority. See docs/hitboxes.md.
 * @typedef {{left:number,top:number,right:number,bottom:number,source:string}} OriginalRectangle
 * @typedef {{kind:string,rectangle:OriginalRectangle,x?:number,y?:number,
 * facing?:number,offsetX?:number,offsetY?:number,itemId?:number,attackType?:number}} BoundsDescriptor
 * @typedef {{active:boolean,requested:boolean,left:number,top:number,right:number,
 * bottom:number,verified:boolean,unknown:boolean,activationKnown:boolean,
 * damaging:null,evidence:string,source:string,status:string}} HitboxShape
 */

const BODY_EVIDENCE = "Maplestory_UNPACKED.exe:0045183b;00af14b8;00af14c8";
const ATTACK_EVIDENCE = "Maplestory_UNPACKED.exe:00414440;00950921";
const DAMAGE_EVIDENCE =
  "Maplestory_UNPACKED.exe:0067fd81;0066a517;0066d9c0;00664559";

/** Allocate a geometry slot outside the tick.
 * @param {string} evidence @returns {HitboxShape} */
function createShape(evidence) {
  return {
    active: false,
    requested: false,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    verified: false,
    unknown: true,
    activationKnown: false,
    damaging: null,
    evidence,
    source: "",
    status: "uninitialized",
  };
}

/** Allocate reusable rectangles. Active means drawable geometry, NOT a hit phase. */
export function createHitboxState() {
  return {
    body: createShape(BODY_EVIDENCE),
    attack: createShape(ATTACK_EVIDENCE),
    damage: createShape(DAMAGE_EVIDENCE),
    previous: createShape(BODY_EVIDENCE),
    contact: {
      active: false,
      x: 0,
      y: 0,
      verified: true,
      evidence: "Maplestory_UNPACKED.exe:009b34c8",
    },
    unknown: true,
    unsupportedActive: false,
    status: "uninitialized",
    unsupported: [
      "attack-selection-and-hit-phase",
      "skill-specific-range-modifiers",
      "projectile-trajectory-and-hit-phase",
      "mob-attack-selection-and-hit-phase",
      "damage-eligibility-and-invulnerability",
      "automatic-morph-mount-frame-selection",
    ],
  };
}

/** @param {HitboxShape} shape @param {string} status */
function resetShape(shape, status) {
  shape.active = false;
  shape.requested = false;
  shape.verified = false;
  shape.unknown = true;
  shape.activationKnown = false;
  shape.damaging = null;
  shape.source = "";
  shape.status = status;
}

/** @param {OriginalRectangle|undefined} rectangle */
function validRectangle(rectangle) {
  return (
    rectangle &&
    Number.isFinite(rectangle.left) &&
    Number.isFinite(rectangle.top) &&
    Number.isFinite(rectangle.right) &&
    Number.isFinite(rectangle.bottom) &&
    rectangle.left <= rectangle.right &&
    rectangle.top <= rectangle.bottom &&
    typeof rectangle.source === "string" &&
    rectangle.source.length > 0
  );
}

/** @param {HitboxShape} shape @param {OriginalRectangle|HitboxShape} rectangle */
function copyRectangle(shape, rectangle) {
  shape.left = rectangle.left;
  shape.top = rectangle.top;
  shape.right = rectangle.right;
  shape.bottom = rectangle.bottom;
  shape.source = rectangle.source;
}

/** Original left-facing coordinates: mirror by negating and exchanging x ends.
 * @param {HitboxShape} shape @param {number} x @param {number} y @param {number} facing */
function placeRectangle(shape, x, y, facing) {
  const left = shape.left;
  shape.left = x + (facing > 0 ? -shape.right : left);
  shape.right = x + (facing > 0 ? -left : shape.right);
  shape.top += y;
  shape.bottom += y;
  shape.active = shape.left < shape.right && shape.top < shape.bottom;
  shape.verified = true;
}

/** @param {HitboxShape} target @param {HitboxShape|OriginalRectangle} other */
function unionRectangle(target, other) {
  if (other.left === other.right || other.top === other.bottom) return;
  if (target.left === target.right || target.top === target.bottom) {
    copyRectangle(target, other);
    return;
  }
  target.left = Math.min(target.left, other.left);
  target.top = Math.min(target.top, other.top);
  target.right = Math.max(target.right, other.right);
  target.bottom = Math.max(target.bottom, other.bottom);
}

/** The selected original mount frame and anchor differences are explicit inputs.
 * @param {HitboxShape} body @param {BoundsDescriptor} descriptor */
function applyMount(body, descriptor) {
  if (!Number.isInteger(descriptor.itemId)) return false;
  const category = Math.trunc(descriptor.itemId / 10000);
  if (
    (category !== 190 && category !== 193) ||
    !Number.isFinite(descriptor.offsetX) ||
    !Number.isFinite(descriptor.offsetY)
  ) {
    return false;
  }
  body.left += descriptor.offsetX;
  body.right += descriptor.offsetX;
  body.top += descriptor.offsetY;
  body.bottom += descriptor.offsetY;
  unionRectangle(body, descriptor.rectangle);
  body.source = descriptor.rectangle.source;
  return true;
}

/** Initialize the fixed ordinary receiver in original left-facing coordinates.
 * @param {HitboxShape} body @param {object} sim */
function setOrdinaryBody(body, sim) {
  const prone = sim.crouching === true && sim.state === "ground";
  body.left = prone ? -46 : -22;
  body.top = prone ? -31 : -65;
  body.right = prone ? 0 : 22;
  body.bottom = 0;
  body.source = prone
    ? "Maplestory_UNPACKED.exe:00af14c8"
    : "Maplestory_UNPACKED.exe:00af14b8";
  body.status = prone ? "ordinary-prone-receiver" : "ordinary-receiver";
}

/** Resolve explicit frame geometry, retaining the unmounted previous receiver.
 * @param {HitboxShape} body @param {HitboxShape} previous
 * @param {BoundsDescriptor|undefined} descriptor */
function resolveBodyFrame(body, previous, descriptor) {
  if (descriptor && !validRectangle(descriptor.rectangle)) {
    body.status = "invalid-original-body-rectangle";
    return false;
  }
  if (descriptor?.kind === "morph") {
    copyRectangle(body, descriptor.rectangle);
    body.status = "explicit-morph-frame-receiver";
  }
  copyRectangle(previous, body);
  if (descriptor?.kind === "mount") {
    if (!applyMount(body, descriptor)) {
      body.status = "unsupported-mount-category-or-offset";
      return false;
    }
    body.status = "explicit-mount-frame-receiver";
  } else if (descriptor && descriptor.kind !== "morph") {
    body.status = "unsupported-body-family";
    return false;
  }
  return true;
}

/** Sweep with the base ordinary/morph rectangle, never the mounted composite.
 * @param {HitboxShape} body @param {HitboxShape} previous
 * @param {{x:number,y:number}} position @param {number} facing */
function sweepBody(body, previous, position, facing) {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    resetShape(body, "invalid-previous-position");
    return;
  }
  placeRectangle(previous, position.x, position.y, facing);
  previous.unknown = false;
  previous.status = "previous-position-receiver";
  unionRectangle(body, previous);
  body.active = body.left < body.right && body.top < body.bottom;
  body.status = "swept-receiver-union";
}

/** Receiver: ordinary constants, frame-dependent morph replacement, mount union.
 * @param {ReturnType<typeof createHitboxState>} output @param {object} sim
 * @param {object} context */
function updateBody(output, sim, context) {
  const body = output.body;
  const previous = output.previous;
  setOrdinaryBody(body, sim);
  if (!resolveBodyFrame(body, previous, context.body)) return;
  placeRectangle(body, sim.x, sim.y, sim.facing);
  body.unknown = false;
  if (context.previousPosition) {
    sweepBody(body, previous, context.previousPosition, sim.facing);
  }
}

/** @param {BoundsDescriptor} descriptor @param {boolean} incoming */
function supportedArea(descriptor, incoming) {
  return incoming
    ? (descriptor.kind === "mob-attack" && descriptor.attackType === 0) ||
        descriptor.kind === "mob-contact"
    : descriptor.kind === "afterimage" || descriptor.kind === "skill-area";
}

/** Preview explicit original metadata independently of unknown damage timing.
 * @param {HitboxShape} shape @param {BoundsDescriptor|undefined} descriptor
 * @param {object} sim @param {boolean} incoming */
function updateArea(shape, descriptor, sim, incoming) {
  if (!descriptor) return;
  shape.requested = true;
  const supported = supportedArea(descriptor, incoming);
  shape.status = supported
    ? "invalid-original-rectangle"
    : "unsupported-area-family";
  if (!supported || !validRectangle(descriptor.rectangle)) return;
  placeArea(shape, descriptor, sim, incoming);
}

/** Outgoing areas default to the actor; incoming areas require their own origin.
 * @param {HitboxShape} shape @param {BoundsDescriptor} descriptor
 * @param {object} sim @param {boolean} incoming */
function placeArea(shape, descriptor, sim, incoming) {
  const x = descriptor.x ?? (incoming ? NaN : sim.x);
  const y = descriptor.y ?? (incoming ? NaN : sim.y);
  const facing = descriptor.facing ?? (incoming ? NaN : sim.facing);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    (facing !== -1 && facing !== 1)
  ) {
    shape.status = "invalid-area-placement";
    return;
  }
  copyRectangle(shape, descriptor.rectangle);
  placeRectangle(shape, x, y, facing);
  shape.status = "original-geometry-preview-activation-unknown";
}

/**
 * Mutate owned slots in world pixels without allocating. Physical crouch drives
 * the ordinary receiver, not context.frame. Explicit descriptors select original
 * metadata; context.frame/elapsedMs/attacking never invent an active hit phase.
 * Fractional simulated positions are retained for overlay placement; original
 * rectangle offsets and facing transform are exact, not sprite approximations.
 * @param {ReturnType<typeof createHitboxState>} output
 * @param {{x:number,y:number,facing:number,state:string,crouching?:boolean}} sim
 * @param {{action:string,frame:number,elapsedMs:number,attacking:boolean,
 * body?:BoundsDescriptor,attack?:BoundsDescriptor,damage?:BoundsDescriptor,
 * previousPosition?:{x:number,y:number}}} context
 */
export function updateHitboxes(output, sim, context) {
  resetShape(output.body, "invalid-body-context");
  resetShape(output.previous, "not-requested");
  resetShape(output.attack, "attack-metadata-unavailable");
  resetShape(output.damage, "mob-combat-context-unavailable");
  output.body.requested = true;
  output.attack.requested = context.attacking === true;
  output.contact.active = false;
  output.unknown = true;
  output.unsupportedActive = output.attack.requested || !!context.damage;
  output.status = "invalid-position-or-facing";
  if (
    !Number.isFinite(sim.x) ||
    !Number.isFinite(sim.y) ||
    (sim.facing !== -1 && sim.facing !== 1)
  ) {
    return;
  }
  output.contact.x = sim.x;
  output.contact.y = sim.y;
  output.contact.active = true;
  updateBody(output, sim, context);
  updateArea(output.attack, context.attack, sim, false);
  updateArea(output.damage, context.damage, sim, true);
  output.unsupportedActive =
    output.unsupportedActive ||
    output.body.unknown ||
    output.attack.requested ||
    output.damage.requested;
  if (!output.body.verified) output.status = output.body.status;
  else {
    output.status =
      output.attack.active || output.damage.active
        ? "geometry-preview-combat-unknown"
        : "receiver-only-combat-unknown";
  }
}
