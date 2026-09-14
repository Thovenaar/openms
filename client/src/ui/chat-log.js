import { HUD_CLIENT_Y } from "./ui-hud.js";

const MAX_MESSAGES = 128;
const MAX_TEXT = 1800;
const MAX_PAGE = 32;
// Original chat type12:008d0821..008d0858 creates12px Arial in ARGB ffffafaf.
const SOURCE_COLORS = Object.freeze({
  "local-system": "#ddd",
  session: "#fff",
  gameplay: "#ffafaf",
});
// 008d01b2 fonts, selected by message type at008dc32f (base+0xbe0+type*4).
// Selector order: buddy, buddy group, party, guild, alliance, spouse, whisper, map.
export const CHAT_CHANNEL_COLORS = Object.freeze([
  "#ff9900",
  "#ff9900",
  "#ff99cc",
  "#e1acfe",
  "#a6ff7f",
  "#ff28a7",
  "#00ff00",
  "#ffffff",
]);

export function chatColor(record) {
  return record.source === "session" && Number.isInteger(record.channelIndex)
    ? (CHAT_CHANNEL_COLORS[record.channelIndex] ?? SOURCE_COLORS.session)
    : SOURCE_COLORS[record.source];
}

function validateRecord(record) {
  if (
    !record ||
    !Object.hasOwn(SOURCE_COLORS, record.source) ||
    typeof record.text !== "string" ||
    !record.text ||
    record.text.length > MAX_TEXT ||
    !Number.isFinite(record.time) ||
    record.time < 0
  ) {
    throw new TypeError("Invalid received chat record");
  }
}

/** Delivered records only. Local speech is not a fabricated server All-chat echo. */
export class ChatLog {
  constructor(panel) {
    this.records = [];
    this.element = panel.contentArea(4, HUD_CLIENT_Y + 486, 566, 25);
    this.element.className = "maple-ui-chat-log";
    this.element.setAttribute("role", "log");
    this.element.setAttribute("aria-label", "Chat messages");
    this.element.setAttribute("aria-live", "polite");
    this.element.tabIndex = 0;
    this.element.style.cssText +=
      ";overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;overflow-anchor:none;pointer-events:auto;scrollbar-width:thin;";
    this.element.hidden = true;
    panel.listen(this.element, "wheel", this.wheel.bind(this));
  }
  wheel(event) {
    event.stopPropagation();
  }
  row(record) {
    const row = document.createElement("div");
    row.dataset.chatSource = record.source;
    if (record.channelIndex !== undefined) {
      row.dataset.chatChannel = String(record.channelIndex);
    }
    row.textContent =
      record.source === "local-system" ? `[Local] ${record.text}` : record.text;
    row.style.color = chatColor(record);
    return row;
  }
  append(record) {
    validateRecord(record);
    const element = this.element;
    const atBottom =
      element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
    let top = element.scrollTop;
    if (this.records.length === MAX_MESSAGES) {
      top = Math.max(0, top - element.firstElementChild.offsetHeight);
      this.records.shift();
      element.firstElementChild.remove();
    }
    const copy = {
      source: record.source,
      text: record.text,
      time: record.time,
      ...(record.channelIndex === undefined
        ? {}
        : { channelIndex: record.channelIndex }),
    };
    this.records.push(copy);
    element.append(this.row(copy));
    element.hidden = false;
    element.scrollTop = atBottom ? element.scrollHeight : top;
  }
  page(offset = 0, limit = 20) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_PAGE
    ) {
      throw new RangeError("Invalid chat page");
    }
    return {
      total: this.records.length,
      offset,
      records: structuredClone(this.records.slice(offset, offset + limit)),
    };
  }
  snapshot() {
    return {
      count: this.records.length,
      scrollTop: this.element.scrollTop,
      scrollHeight: this.element.scrollHeight,
    };
  }
  destroy() {
    this.element.remove();
  }
}
