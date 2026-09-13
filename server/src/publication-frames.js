import { protocolError } from "../../shared/protocol.js";

export const MAX_FRAME_BYTES = 64 * 1024;
export const MAX_SNAPSHOT_PARTS = 64;

export function frameBytes(frame) {
  return Buffer.byteLength(JSON.stringify(frame));
}

/** Source views already bound rows to 128. Split further using the complete wire envelope. */
export function paginateViews(views, envelope) {
  const result = [];
  for (const view of views) {
    if (frameBytes(envelope(view)) <= MAX_FRAME_BYTES) result.push(view);
    else result.push(...splitView(view, envelope));
    if (result.length > MAX_SNAPSHOT_PARTS) throw protocolError("SERVER_BUSY");
  }
  return result;
}

function splitView(view, envelope) {
  const keys = {
    entities: "entities",
    inventory: "items",
    progress: view.quests?.length ? "quests" : "skills",
  };
  const key = keys[view.kind];
  const rows = view[key];
  if (!Array.isArray(rows) || !rows.length || rows.length > 128) {
    throw protocolError("SERVER_BUSY");
  }
  const result = [];
  let start = 0;
  while (start < rows.length) {
    let count = rows.length - start;
    let part = { ...view, [key]: rows.slice(start, start + count) };
    while (frameBytes(envelope(part)) > MAX_FRAME_BYTES) {
      if (count === 1) throw protocolError("SERVER_BUSY");
      count = Math.ceil(count / 2);
      part = { ...view, [key]: rows.slice(start, start + count) };
    }
    result.push(part);
    if (result.length > MAX_SNAPSHOT_PARTS) throw protocolError("SERVER_BUSY");
    start += count;
  }
  return result;
}
