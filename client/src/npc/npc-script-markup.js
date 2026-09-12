/** Shared CUtilDlgEx text-token order: a choice's closing # is not another token. */
export const NPC_MARKUP_TOKENS =
  /#L\d+#|#l|#h(?:0| )?#|#@\d+:#|#[ptomciavuyz]\d+:?#|#[bgrdken]|#[fF][^#\r\n]+#|##|#(?=\n|$)/g;
export const NPC_MARKUP_FAMILIES = Object.freeze({
  p: "npcIds",
  "@": "npcIds",
  t: "itemIds",
  i: "itemIds",
  v: "itemIds",
  z: "itemIds",
  c: "itemIds",
  m: "mapIds",
  o: "mobIds",
  u: "questIds",
  y: "questIds",
  a: "questIds",
});
export const NPC_ARTWORK_LIMITS = Object.freeze({
  paths: 8192,
  pathLength: 4096,
  images: 128,
  pixels: 1048576,
});

/** Paths retain source spelling; only rooted WZ property paths, never filesystem traversal. */
export function validNpcArtworkPath(path) {
  if (
    typeof path !== "string" ||
    !path.length ||
    path.length > NPC_ARTWORK_LIMITS.pathLength
  ) {
    return false;
  }
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code <= 32 || code === 127 || "#\\:?".includes(path[index])) {
      return false;
    }
  }
  const parts = path.split("/");
  return (
    parts.length > 1 &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

export function npcMarkupId(code, encoded) {
  if (!Number.isSafeInteger(encoded) || encoded <= 0 || encoded > 2147483647) {
    return NaN;
  }
  return code === "a" ? Math.trunc(encoded / 10) : encoded;
}
