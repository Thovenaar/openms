import { coordinate, detachGround } from "./geometry.js";
const MAX_LADDERS = 4096;
/** 00a45b03 original horizontal capture tolerance. */
const CAPTURE_WIDTH = 10;
/** 009cc627 / 00af3728: three pixels per original movement update. */
const CLIMB_STEP = 3;

export function prepareLadders(ladders) {
  if (!Array.isArray(ladders) || ladders.length > MAX_LADDERS) {
    throw new Error("Unsupported ladder count");
  }
  const ids = new Set();
  const output = [];
  for (const source of ladders) {
    if (
      !Number.isSafeInteger(source.id) ||
      source.id < 0 ||
      ids.has(source.id)
    ) {
      throw new Error("Invalid ladder identifier");
    }
    ids.add(source.id);
    const x = coordinate(source.x);
    const y1 = coordinate(source.y1);
    const y2 = coordinate(source.y2);
    if (y2 < y1) throw new Error("Reversed ladder bounds");
    output.push({
      id: source.id,
      x,
      y1,
      y2,
      ladder: source.ladder,
      uf: source.uf,
      page: coordinate(source.page),
    });
  }
  return output;
}

/** 009cbefb: ground capture up to20px above feet; down capture10px below. */
export function captureLadder(sim, vertical) {
  if (vertical === 0 || sim.ignoredFootholdId !== 0) return;
  const grounded = sim.state === "ground";
  if (!grounded && (vertical >= 0 || sim.vy <= 0)) return;
  const top = grounded && vertical < 0 ? sim.y - 20 : sim.previousY;
  const bottom = grounded && vertical > 0 ? sim.y + 10 : sim.y;
  for (const ladder of sim.ladders) {
    if (!canCapture(sim, ladder, top, bottom)) continue;
    attachLadder(sim, ladder);
    return;
  }
}

function attachLadder(sim, ladder) {
  if (ladder.ladder === null || ladder.uf === null) {
    sim.diagnostics.unsupportedLadderFlags = true;
    return;
  }
  detachGround(sim);
  sim.state = "ladder";
  sim.ladder = ladder;
  sim.ladderId = ladder.id;
  sim.contactLayer = ladder.page;
  sim.contactGroup = 0;
  sim.x = ladder.x;
  sim.y = Math.max(ladder.y1, Math.min(ladder.y2, sim.y));
  sim.vx = 0;
  sim.vy = 0;
}

function canCapture(sim, ladder, top, bottom) {
  const left = Math.min(sim.previousX, sim.x) - CAPTURE_WIDTH;
  const right = Math.max(sim.previousX, sim.x) + CAPTURE_WIDTH;
  return (
    ladder.x >= left &&
    ladder.x <= right &&
    ladder.y1 <= Math.max(top, bottom) &&
    ladder.y2 >= Math.min(top, bottom)
  );
}

/** Exact endpoint offsets from 009cc627; step cadence is documented separately. */
export function climb(sim, vertical) {
  const ladder = sim.ladder;
  sim.y += vertical * CLIMB_STEP;
  sim.vx = 0;
  sim.vy = 0;
  if (sim.y < ladder.y1) {
    if (ladder.uf === 0) sim.y = ladder.y1;
    else {
      sim.y = ladder.y1 - 5;
      releaseLadder(sim);
    }
  } else if (sim.y > ladder.y2) {
    sim.y = ladder.y2 + 1;
    releaseLadder(sim);
  }
}

export function releaseLadder(sim) {
  sim.ladder = null;
  sim.ladderId = 0;
  sim.state = "air";
}
