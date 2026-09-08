/** Browser resource limits, not original game constants. */
export const MAX_SEGMENTS = 65536;
export const MAX_COORDINATE = 1000000;
export const MAX_TRANSITIONS = 32;

/** Validate original integer coordinates before cross products. */
export function coordinate(value) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new Error("Physics coordinate exceeds supported range");
  }
  return value;
}

/** Construct immutable tangent geometry outside the simulation loop. */
export function prepareSegments(footholds) {
  if (!Array.isArray(footholds) || footholds.length > MAX_SEGMENTS) {
    throw new Error("Unsupported foothold count");
  }
  const segments = [];
  const byId = new Map();
  for (const source of footholds) {
    if (
      !Number.isSafeInteger(source.id) ||
      source.id <= 0 ||
      byId.has(source.id)
    ) {
      throw new Error("Invalid or duplicate foothold identifier");
    }
    const segment = makeSegment(source);
    segments.push(segment);
    byId.set(segment.id, segment);
  }
  for (const segment of segments) {
    segment.prev = resolveLink(byId, segment.prevId);
    segment.next = resolveLink(byId, segment.nextId);
  }
  return { segments, byId };
}

function resolveLink(byId, id) {
  if (id === 0) return null;
  if (!Number.isSafeInteger(id) || !byId.has(id)) {
    throw new Error("Foothold link does not resolve");
  }
  return byId.get(id);
}

function makeSegment(source) {
  const x1 = coordinate(source.x1);
  const y1 = coordinate(source.y1);
  const x2 = coordinate(source.x2);
  const y2 = coordinate(source.y2);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (
    !Number.isSafeInteger(source.layer) ||
    source.layer < 0 ||
    source.layer > 7 ||
    !Number.isSafeInteger(source.group) ||
    source.group < 0 ||
    source.group > 2147483647
  ) {
    throw new Error("Invalid original foothold drawing plane");
  }
  if (length === 0) throw new Error("Degenerate foothold");
  return {
    id: source.id,
    layer: source.layer,
    group: source.group,
    x1,
    y1,
    x2,
    y2,
    dx,
    dy,
    length,
    tx: dx / length,
    ty: dy / length,
    conveyor: footholdScalar(source.properties?.force, 0),
    friction: footholdScalar(source.properties?.drag, 1),
    prevId: source.prev,
    nextId: source.next,
    prev: null,
    next: null,
    properties: source.properties ?? {},
  };
}

/** 00a44707..49: nonzero integer properties become hundredths; zero keeps constructor value. */
function footholdScalar(value = 0, fallback) {
  if (
    !Number.isSafeInteger(value) ||
    value < -2147483648 ||
    value > 2147483647
  ) {
    throw new Error("Invalid original foothold attribute");
  }
  return value === 0 ? fallback : value * 0.01;
}

/** Original 009b1646: world position/velocity from distance and tangent speed. */
export function projectGround(sim) {
  const segment = sim.foothold;
  sim.contactLayer = segment.layer;
  sim.contactGroup = segment.group;
  sim.x = segment.x1 + segment.tx * sim.position;
  sim.y = segment.y1 + segment.ty * sim.position;
  sim.vx = segment.tx * sim.speed;
  sim.vy = segment.ty * sim.speed;
}

/** Original 009b1553: project velocity, clamp distance to finite segment. */
export function attachGround(sim, segment) {
  sim.foothold = segment;
  sim.footholdId = segment.id;
  sim.ladderId = 0;
  sim.ladder = null;
  sim.state = "ground";
  sim.position = Math.max(
    0,
    Math.min(
      segment.length,
      (sim.x - segment.x1) * segment.tx + (sim.y - segment.y1) * segment.ty,
    ),
  );
  sim.speed = sim.vx * segment.tx + sim.vy * segment.ty;
  projectGround(sim);
}

export function detachGround(sim) {
  sim.foothold = null;
  sim.footholdId = 0;
  sim.state = "air";
}

/** Truncated integer swept-point crossing: original 009b34c8. */
export function crossingFraction(sim, segment) {
  const x = Math.trunc(sim.previousX);
  const y = Math.trunc(sim.previousY);
  const endX = Math.trunc(sim.x);
  const endY = Math.trunc(sim.y);
  const startSide =
    (y - segment.y1) * segment.dx - (x - segment.x1) * segment.dy;
  const endSide =
    (endY - segment.y1) * segment.dx - (endX - segment.x1) * segment.dy;
  if (startSide > 0 || endSide < 0 || startSide === endSide) return -1;
  const fraction = startSide / (startSide - endSide);
  const hitX = x + (endX - x) * fraction;
  const hitY = y + (endY - y) * fraction;
  const distance =
    (hitX - segment.x1) * segment.tx + (hitY - segment.y1) * segment.ty;
  if (distance < 0 || distance > segment.length) return -1;
  return fraction;
}
