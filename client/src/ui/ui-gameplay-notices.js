import { UISurface } from "./ui-surface.js";

// Original EXE 0089ae9a/0089b159/0089b60f/0089b76f; not CUIStatusBar's chat log.
const ROW_COUNT = 6;
const ROW_WIDTH = 290;
const ROW_HEIGHT = 14;
const SURFACE_HEIGHT = ROW_COUNT * ROW_HEIGHT;
const RIGHT_MARGIN = 6;
const BOTTOM_ANCHOR = 157;
const FADE_MS = 6000;
const FONT = "12px Arial"; // 0098a707, string0x1597; browser glyph rasterization differs from Windows.
const WHITE = "#ffffff";
const YELLOW = "#ffff20";
const SHADOW = "#000000";
// 005cfa86 -> original string IDs 0xa,0x15dc,0xb,0x15a2,0x159c.
const TAB_NAMES = Object.freeze(["", "Eqp", "Use", "Setup", "Etc", "Cash"]);
const ELLIPSIS = ".."; // 00988cf3, string0x890, not a Unicode ellipsis.
const MAX_NAME_LENGTH = 4096; // Browser catalog/raster work budget, not a native name limit.
const MAX_NOTICE_LENGTH = 4096; // Browser received-text measurement budget, not a native limit.
const MAX_RASTER_DIMENSION = 8192;
const MAX_RASTER_BYTES = 16 * 1024 * 1024;

/**
 * @typedef {{kind:'item',itemId:number,amount:number} |
 * {kind:'meso',amount:number} | {kind:'exp',amount:number,white:boolean} |
 * {kind:'inventory-full'}} GameplayNoticeEvent
 * Amounts are original signed32 values, including zero. This view grants nothing.
 */

/** Six retained native notice canvases, plus one browser composition target.
 * The owner supplies its prepared HUD, index.items[id].name and logical viewport bounds.
 * It owns this view's lifetime; the view only borrows the HUD resource, never UIChat.
 */
export class GameplayNoticeLog {
  constructor(owner) {
    if (!owner.hud?.resource || !owner.index?.items) {
      throw new Error(
        "Gameplay notices require the prepared HUD and original item-name catalog",
      );
    }
    this.owner = owner;
    // 0089ae9a pre-populates the queue with six empty canvases.
    this.count = ROW_COUNT;
    this.first = 0;
    this.clock = 0;
    this.destroyed = false;
    this.dirty = true;
    this.densityX = 0;
    this.rasterWidth = ROW_WIDTH;
    this.densityY = 0;
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = `display:block;width:${ROW_WIDTH}px;height:${SURFACE_HEIGHT}px;pointer-events:none;`;
    this.context = canvasContext(this.canvas);
    this.rows = new Array(ROW_COUNT);
    for (let index = 0; index < ROW_COUNT; index++) {
      this.rows[index] = createRow();
    }
    this.syncDensity();
    // Text-only: UISurface's interaction/lifetime plane, without an unused atlas raster scan.
    this.surface = new UISurface(
      { root: owner.root, host: owner.host },
      "Gameplay notices",
      owner.hud.resource,
      [ROW_WIDTH, SURFACE_HEIGHT],
    );
    this.surface.ownsResource = false;
    this.surface.element.style.pointerEvents = "none";
    this.surface.element.style.zIndex = "0";
    this.surface.element.setAttribute("role", "log");
    this.surface.element.setAttribute("aria-live", "polite");
    this.surface.element.append(this.canvas);
  }

  /** Publish ONLY admitted gameplay outcomes; missing/empty original item names emit nothing.
   * @param {GameplayNoticeEvent} event
   * @returns {boolean} Whether a notice was admitted. Invalid events throw, never print here.
   */
  publish(event) {
    if (this.destroyed) return false;
    validateEvent(event);
    this.syncDensity();
    const text = noticeText(this, event);
    if (!text) return false;
    if (!this.canRasterText(text)) return false;
    this.appendLine(text, event);
    this.positionRows();
    this.draw();
    return true;
  }

  /** Received system records retain their full history in the separate chat owner. */
  publishSimple(text) {
    if (this.destroyed) return false;
    this.syncDensity();
    if (typeof text !== "string" || text.length > MAX_NOTICE_LENGTH) {
      throw new RangeError("Gameplay notice exceeds the browser text budget");
    }
    if (!text.trim()) return false;
    // Received history belongs to UIChat even when its transient ink exceeds our budget.
    if (!this.canRasterText(text)) return false;
    this.appendLine(text, { kind: "simple" });
    this.positionRows();
    this.draw();
    return true;
  }

  appendLine(text, event) {
    let index = (this.first + this.count) % ROW_COUNT;
    if (this.count === ROW_COUNT) {
      index = this.first;
      this.first = (this.first + 1) % ROW_COUNT;
    } else {
      this.count++;
    }
    const row = this.rows[index];
    row.text = text;
    row.color = event.kind === "exp" && !event.white ? YELLOW : WHITE;
    row.born = this.clock;
    row.alpha = 255;
    row.accessible.textContent = text;
    this.canvas.append(row.accessible);
    this.resizeInk();
  }

  canRasterText(text) {
    const width = Math.ceil(
      noticeInkWidth(this.rows[0].context, text) * this.densityX,
    );
    const height = Math.ceil(SURFACE_HEIGHT * this.densityY);
    const rowHeight = Math.ceil(ROW_HEIGHT * this.densityY);
    return (
      width <= MAX_RASTER_DIMENSION &&
      width * (height + ROW_COUNT * rowHeight) * 4 <= MAX_RASTER_BYTES
    );
  }

  resizeInk() {
    let width = ROW_WIDTH;
    for (let index = 0; index < this.count; index++) {
      const row = this.rows[(this.first + index) % ROW_COUNT];
      width = Math.max(width, noticeInkWidth(row.context, row.text));
    }
    this.rasterWidth = width;
    // Browser-only unclipped ink backing. The native layer/anchor remains 290px wide.
    this.canvas.style.width = `${width}px`;
    this.canvas.style.marginLeft = `${ROW_WIDTH - width}px`;
    this.syncDensity(true);
  }

  /** Compositor elapsed milliseconds, independent of physics steps and chat expansion.
   * update(0) also refreshes density while paused; no strings/objects are built in the draw loop.
   * @param {number} ms Finite nonnegative elapsed presentation time.
   */
  update(ms) {
    if (this.destroyed) return;
    if (
      !Number.isFinite(ms) ||
      ms < 0 ||
      this.clock + ms > Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError("Invalid gameplay notice elapsed milliseconds");
    }
    this.clock += ms;
    this.syncDensity();
    for (let index = 0; index < this.count; index++) {
      if (advanceRow(this.rows[(this.first + index) % ROW_COUNT], this.clock)) {
        this.dirty = true;
      }
    }
    if (this.dirty) this.draw();
  }

  /** Browser policy: keep native collapsed screen(504,443) even with quickslots open.
   * No stretch: retain the6px right margin and HUD bottom offsets in the owner's logical plane.
   * @param {{left:number,top:number,right:number,bottom:number}} bounds Logical viewport edges.
   */
  resize(bounds) {
    if (this.destroyed) return;
    if (!validBounds(bounds)) {
      throw new RangeError("Invalid gameplay notice viewport bounds");
    }
    this.surface.position(
      bounds.right - RIGHT_MARGIN - ROW_WIDTH,
      bounds.bottom - BOTTOM_ANCHOR,
    );
    this.syncDensity();
    if (this.dirty) this.draw();
  }

  positionRows() {
    // Keep the requested fixed HUD anchor; six rows retain their native spacing.
    for (let index = 0; index < this.count; index++) {
      this.rows[(this.first + index) % ROW_COUNT].y = index * ROW_HEIGHT;
    }
    this.dirty = true;
  }

  syncDensity(force = false) {
    const ratio = window.devicePixelRatio || 1;
    const x = (this.owner.screenScaleX ?? 1) * ratio;
    const y = (this.owner.screenScaleY ?? 1) * ratio;
    if (!force && x === this.densityX && y === this.densityY) return;
    const width = Math.ceil(this.rasterWidth * x);
    const height = Math.ceil(SURFACE_HEIGHT * y);
    const rowHeight = Math.ceil(ROW_HEIGHT * y);
    validateRasterSize(width, height, rowHeight);
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.setTransform(
      width / this.rasterWidth,
      0,
      0,
      height / SURFACE_HEIGHT,
      0,
      0,
    );
    this.densityX = x;
    this.densityY = y;
    for (let index = 0; index < ROW_COUNT; index++) {
      const row = this.rows[index];
      row.canvas.width = width;
      row.canvas.height = rowHeight;
      row.context.setTransform(
        width / this.rasterWidth,
        0,
        0,
        rowHeight / ROW_HEIGHT,
        0,
        0,
      );
      row.context.font = FONT;
      row.context.textBaseline = "top";
      rasterRow(row, this.rasterWidth);
    }
    this.dirty = true;
  }

  draw() {
    this.context.clearRect(0, 0, this.rasterWidth, SURFACE_HEIGHT);
    for (let index = 0; index < this.count; index++) {
      const row = this.rows[(this.first + index) % ROW_COUNT];
      if (row.alpha === 0) continue;
      this.context.globalAlpha = row.alpha / 255;
      this.context.drawImage(
        row.canvas,
        0,
        row.y,
        this.rasterWidth,
        ROW_HEIGHT,
      );
    }
    this.context.globalAlpha = 1;
    this.dirty = false;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.surface.destroy();
    for (let index = 0; index < ROW_COUNT; index++) {
      const row = this.rows[index];
      row.canvas.width = 0;
      row.canvas.height = 0;
      row.text = "";
      row.accessible.remove();
    }
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.rows.length = 0;
    this.count = 0;
  }
}

function canvasContext(canvas) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Gameplay notices require a Canvas2D text compositor");
  }
  return context;
}

function createRow() {
  const canvas = document.createElement("canvas");
  const accessible = document.createElement("span");
  accessible.setAttribute("role", "listitem");
  return {
    canvas,
    context: canvasContext(canvas),
    accessible,
    text: "",
    color: WHITE,
    born: 0,
    alpha: 0,
    y: 0,
  };
}

function rasterRow(row, width) {
  const context = row.context;
  context.clearRect(0, 0, width, ROW_HEIGHT);
  if (!row.text) return;
  const metrics = context.measureText(row.text);
  const x = width - Math.ceil(metrics.width);
  context.fillStyle = SHADOW;
  context.fillText(row.text, x + 1, 1);
  context.fillStyle = row.color;
  context.fillText(row.text, x, 0);
}

/** 0089b159 measures/draws one whole record; it never word-wraps.
 * Only the browser backing extends left to avoid clipping wider platform glyphs.
 * Preserve the right edge, native font, formatter and item-name shortening.
 */
export function noticeInkWidth(context, text) {
  const metrics = context.measureText(text);
  return Math.max(
    ROW_WIDTH,
    Math.ceil(metrics.width) +
      Math.ceil(Math.max(0, metrics.actualBoundingBoxLeft ?? 0)),
  );
}

/** Shape2D.dll vector vtable+0x90=5140828f ->51407fe1 ->5140809f.
 * The default operator uses SIGNED INTEGER division, no hold/easing:255+trunc(-255*t/6000).
 * Alpha zero does not delete the node;0089b159 evicts only when the six-entry queue is full.
 */
function advanceRow(row, clock) {
  const age = Math.trunc(clock - row.born);
  const alpha = age >= FADE_MS ? 0 : 255 + Math.trunc((-255 * age) / FADE_MS);
  const changed = row.alpha !== alpha;
  row.alpha = alpha;
  return changed;
}

function validateEvent(event) {
  if (!event || typeof event !== "object") {
    throw new TypeError("Invalid gameplay notice event");
  }
  if (event.kind === "inventory-full") return;
  if (event.kind !== "item" && event.kind !== "meso" && event.kind !== "exp") {
    throw new TypeError("Unknown gameplay notice kind");
  }
  if (
    !Number.isInteger(event.amount) ||
    event.amount < -2147483648 ||
    event.amount > 2147483647
  ) {
    throw new RangeError("Gameplay notice amount must be signed32");
  }
  validateEventDetails(event);
}

function validateEventDetails(event) {
  if (event.kind === "exp" && typeof event.white !== "boolean") {
    throw new TypeError("Gameplay EXP notice requires the original white flag");
  }
  if (
    event.kind === "item" &&
    (!Number.isInteger(event.itemId) ||
      event.itemId < 1000000 ||
      event.itemId >= 6000000)
  ) {
    throw new RangeError(
      "Gameplay item notice requires an original inventory item ID",
    );
  }
}

function noticeText(log, event) {
  switch (event.kind) {
    case "inventory-full":
      return "You can't get anymore items."; //0x127
    case "meso":
      return `You have gained mesos (+${event.amount})`; //0x122, NOT subtype5.
    case "exp":
      return `You have gained experience (+${event.amount})`; //0x119
    case "item":
      return itemText(log, event);
    default:
      throw new TypeError("Unknown gameplay notice kind");
  }
}

function itemText(log, event) {
  const original = log.owner.index.items[event.itemId]?.name;
  if (original === undefined || original === "") return ""; //00a20c69..7a
  if (typeof original !== "string" || original.length > MAX_NAME_LENGTH) {
    throw new RangeError(
      "Original item name exceeds the gameplay notice catalog budget",
    );
  }
  const plural = event.amount >= 2;
  const name = fitItemName(log.rows[0].context, original, plural ? 96 : 120);
  const tab = TAB_NAMES[Math.trunc(event.itemId / 1000000)];
  return plural
    ? `You have gained items in the ${tab} tab (${name} [${event.amount}])`
    : `You have gained an item in the ${tab} tab (${name} [${event.amount}])`;
}

/** 00988cf3 fits the original name, subtracting string0x890's width only when truncating.
 * Formatting is admission-only; neither measuring nor string creation occurs per draw.
 */
function fitItemName(context, name, width) {
  if (Math.ceil(context.measureText(name).width) <= width) return name;
  const available = width - Math.ceil(context.measureText(ELLIPSIS).width);
  let count = 0;
  for (let end = 1; end <= name.length; end++) {
    const code = name.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff && end < name.length) end++;
    if (Math.ceil(context.measureText(name.slice(0, end)).width) > available) {
      break;
    }
    count = end;
  }
  return name.slice(0, count) + ELLIPSIS;
}

function validBounds(bounds) {
  return (
    bounds &&
    Number.isFinite(bounds.left) &&
    Number.isFinite(bounds.top) &&
    Number.isFinite(bounds.right) &&
    Number.isFinite(bounds.bottom) &&
    bounds.right > bounds.left &&
    bounds.bottom > bounds.top
  );
}

function validateRasterSize(width, height, rowHeight) {
  const bytes = width * (height + ROW_COUNT * rowHeight) * 4;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_RASTER_DIMENSION ||
    height > MAX_RASTER_DIMENSION ||
    bytes > MAX_RASTER_BYTES
  ) {
    throw new RangeError(
      "Gameplay notice backing canvases exceed the browser raster budget",
    );
  }
}
