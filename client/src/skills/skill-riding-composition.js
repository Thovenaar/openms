import {
  placeCandidates,
  AVATAR_LIMITS,
} from "../character/avatar-composition.js";

/** Reuse original anchor-forest placement, then interleave rider/saddle/mount canvas z. */
export function composeRiding(mount, saddle, rider, riderAnchor) {
  const actions = Object.create(null);
  const entries = Object.entries(mount.frames);
  if (entries.length > AVATAR_LIMITS.actions) {
    throw new Error("Riding action bound exceeded");
  }
  for (const [action, frames] of entries) {
    actions[action] = frames.map((frame, index) =>
      composeRidingFrame({
        mount,
        saddle,
        rider: rider.actions.sit?.[0],
        riderAnchor,
        frame,
        saddleFrame: saddle?.frames[action]?.[index] ?? null,
      }),
    );
  }
  return {
    id: "skill:riding",
    order: 0,
    kind: "effect",
    x: 0,
    y: 0,
    z: 0,
    visible: false,
    flip: false,
    opacity: 1,
    action: "stand1",
    actions,
  };
}

function composeRidingFrame(input) {
  if (!input.rider) throw new Error("Original rider sit pose is unavailable");
  const candidates = input.frame.parts.map((part) => ({
    part,
    priority: input.mount.priority,
    visible: true,
  }));
  for (const part of input.saddleFrame?.parts ?? []) {
    candidates.push({ part, priority: input.saddle.priority, visible: true });
  }
  placeCandidates(candidates, "");
  const anchor = candidates.find((candidate) => candidate.part.anchors.navel);
  if (!anchor) {
    throw new Error("Original mount frame has no rider navel anchor");
  }
  const navel = anchor.part.anchors.navel;
  const dx = navel.x + anchor.position.x - input.riderAnchor.x;
  const dy = navel.y + anchor.position.y - input.riderAnchor.y;
  const parts = candidates
    .filter((candidate) => candidate.visible)
    .map((candidate) => ({
      texture: candidate.part.texture,
      x: candidate.part.x + candidate.position.x,
      y: candidate.part.y + candidate.position.y,
      z: candidate.part.z,
    }));
  for (const part of input.rider.parts) {
    parts.push({ ...part, x: part.x + dx, y: part.y + dy });
  }
  if (parts.length > AVATAR_LIMITS.parts) {
    throw new Error("Riding frame part bound exceeded");
  }
  return { delay: input.frame.delay, parts };
}
