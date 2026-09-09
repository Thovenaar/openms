/** Address-linked loader facts from docs/ghidra-physics-options, not name-based semantics. */
const GLOBAL_KEYS = [
  "walkForce",
  "walkSpeed",
  "walkDrag",
  "slipForce",
  "slipSpeed",
  "floatDrag1",
  "floatDrag2",
  "floatCoefficient",
  "swimForce",
  "swimSpeed",
  "flyForce",
  "flySpeed",
  "gravityAcc",
  "fallSpeed",
  "jumpSpeed",
  "maxFriction",
  "minFriction",
  "swimSpeedDec",
  "flyJumpDec",
];

/** Status supported means original loading/extraction is recovered, not complete
 * simulation fidelity. Unrecovered runtime precedence always remains explicit.
 * @param {any} option */
export function annotatePhysicsOption(option) {
  const key = option.path.split("/").at(-1);
  if (option.path.startsWith("Map.wz/Physics.img/")) {
    const globalIndex = GLOBAL_KEYS.indexOf(key);
    if (globalIndex < 0 || option.path !== `Map.wz/Physics.img/${key}`) return;
    option.consumers = ["00a43433", "00440d21"];
    option.default = 0;
    option.precedence =
      "WZ value converted to double; EMPTY/ERROR/failed conversion uses zero";
    option.status = "supported";
    option.structOffset = globalIndex * 8;
    return;
  }
  annotateGeometry(option, key);
  annotateTemplates(option, key);
  annotateFieldEffects(option);
  annotateWorldBounds(option);
}

/** Attach original foothold and ladder loading evidence. */
function annotateGeometry(option, key) {
  if (
    /^Map.*\/foothold\/.*\/(x1|x2|y1|y2|prev|next|drag|force|forbidFallDown)$/.test(
      option.path,
    )
  ) {
    option.consumers = footholdConsumers(key);
    option.default = 0;
    option.precedence =
      "Original geometry; nonzero drag/force use hundredths, zero preserves constructor; drop queries300/600/5 ignore source. Subunit opposing conveyor exception remains unresolved; see physics-refinements.md";
    option.status = "supported";
  }
  if (/^Map.*\/ladderRope\/.*\/(l|uf|page|x|y1|y2)$/.test(option.path)) {
    option.consumers =
      key === "page"
        ? ["00a43e7b", "009b4929"]
        : ["00a43e7b", "009cbefb", "009cc627"];
    option.default = 0;
    option.precedence =
      "l/uf converted to booleans; page supplies drawing plane, group zero; capture/climb and endpoint rules recovered";
    option.status = "supported";
  }
}

function footholdConsumers(key) {
  if (key === "drag" || key === "force") return ["00a43e7b", "009b23f2"];
  if (key === "forbidFallDown") return ["00a43e7b", "0094c4f8"];
  return ["00a43e7b", "009b3fd1", "009b34c8"];
}

/** Original CSpace2D clipping, distinct from camera view rectangle. */
function annotateWorldBounds(option) {
  if (
    !/^Map.*\/info\/(VRLeft|VRRight|VRTop|VRBottom|VRLimit)$/.test(option.path)
  ) {
    return;
  }
  option.consumers = [
    "00a43e7b",
    "009b1288",
    "009b12a8",
    "009b45c1",
    "009b47aa",
  ];
  option.default = 0;
  option.status = "supported";
  option.precedence =
    "Foothold extrema +30/-30/-300/+10; VRLimit gates nonzero VR edges with +20/-20/+65/0 offsets; spawn clamps all axes, motion clips X/top only";
}

/** Attach original equipment, mount and morph template loading evidence. */
function annotateTemplates(option, key) {
  if (
    /^Character.*\/info\/(incSpeed|incJump|incSwim|fs|swim)$/.test(option.path)
  ) {
    option.consumers = ["005cac3d"];
    option.default = key === "fs" ? 1 : key === "swim" ? 100 : 0;
    option.precedence =
      "Equipment template loading recovered; equipment/temporary-stat composition not established by this inventory";
  }
  if (/^TamingMob.*\/info\/(speed|jump|fs|swim)$/.test(option.path)) {
    option.consumers = ["007af814", "007afc40"];
    option.default = key === "fs" ? 1 : 100;
    option.precedence =
      key === "speed"
        ? "Template clamp 80..190"
        : key === "jump"
          ? "Template upper clamp 123"
          : "Template value; rider override precedence unrecovered";
  }
  if (/^Morph.*\/info\/(speed|jump|fs|swim)$/.test(option.path)) {
    option.consumers = ["006883cf", "0068889f"];
    option.default = key === "fs" ? 1 : 100;
    option.precedence =
      key === "speed"
        ? "Template clamp 80..140"
        : key === "jump"
          ? "Template upper clamp 123"
          : "Template value; character override precedence unrecovered";
  }
}

/** Attach skill, portal and field-mode evidence without claiming runtime fidelity. */
function annotateFieldEffects(option) {
  if (/^Skill.*\/skill\/.*\/level\/.*\/(speed|jump)$/.test(option.path)) {
    option.consumers = ["0075f464"];
    option.precedence =
      "Skill-level loader recovered; job/skill/temporary-stat application branches unresolved";
  }
  if (
    /^Map.*\/portal\/.*\/(horizontalImpact|verticalImpact)$/.test(option.path)
  ) {
    option.consumers = ["0071165a"];
    option.precedence =
      "Portal integer fields +0x38/+0x34 loaded; activation and impulse application unresolved";
  }
  if (/^Map.*\/info\/fs$/.test(option.path)) {
    option.consumers = ["0052b2b5", "00a45b8c", "00a45cd6"];
    option.default = 1;
    option.precedence =
      "Map fs feeds both force/drag attributes; zero reads back as one";
  }
  if (/^Map.*\/swimArea\//.test(option.path)) {
    option.consumers = ["0052b2b5"];
    option.precedence =
      "Local rectangle loading recovered; global-mode overlap and boundary timing unresolved";
  }
  if (/^Map.*\/info\/(swim|fly)$/.test(option.path)) {
    option.consumers = ["00529ef2", "00a45b8c"];
    option.default = 0;
    option.precedence =
      "Nonzero field flags; swim mode 1 takes precedence over fly mode 2; local swimArea overlap unresolved";
  }
}
