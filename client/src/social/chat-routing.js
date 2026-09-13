import { socialRequire } from "./local-social-context.js";

export const NATIVE_CHAT_CHANNELS = Object.freeze({
  buddy: 0,
  group: 1,
  party: 2,
  guild: 3,
  alliance: 4,
  spouse: 5,
  whisper: 6,
  all: 7,
});
// Original decoded strings0x7a..0x80, help0x3a7..0x3ab. No invented /w or /msg aliases.
const COMMAND_CHANNELS = Object.freeze({
  "/buddy": 0,
  "/party": 2,
  "/guild": 3,
  "/alliance": 4,
  "/couple": 5,
  "/whisper": 6,
  "/all": 7,
});

/** Parse bounded native HUD input only; caller owns exact-name resolution and delivery admission. */
export function parseNativeChat(request, whisperId) {
  if (!request.text.startsWith("/")) return request;
  const space = request.text.indexOf(" ");
  const command = space < 0 ? request.text : request.text.slice(0, space);
  socialRequire(
    request.channelIndex !== "messenger" &&
      Object.hasOwn(COMMAND_CHANNELS, command),
    "chat-command",
    "This slash command has no implemented original-client chat route. Use the corresponding native window; nothing was delivered.",
  );
  const parsed = {
    ...request,
    channelIndex: COMMAND_CHANNELS[command],
    text: space < 0 ? "" : request.text.slice(space + 1).trim(),
  };
  if (parsed.channelIndex !== 6) return parsed;
  if (parsed.text) {
    const split = parsed.text.indexOf(" ");
    parsed.recipientName =
      split < 0 ? parsed.text : parsed.text.slice(0, split);
    parsed.text = split < 0 ? "" : parsed.text.slice(split + 1).trim();
  } else parsed.targetId = request.targetId ?? whisperId;
  return parsed;
}
