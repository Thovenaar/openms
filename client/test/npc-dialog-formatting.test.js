import { expect, test } from "bun:test";
import { renderQuestText } from "../src/ui/quest-ui.js";
import {
  dialogGeometry,
  dialogPortraitGeometry,
  NativeDialogLayout,
} from "../src/ui/ui-dialog-layout.js";

function node(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    textContent: "",
    children: [],
    dataset: {},
    style: { cssText: "" },
    attributes: {},
    append(child) {
      this.children.push(child);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function render(text, options = {}) {
  const previous = globalThis.document;
  const root = node("div");
  globalThis.document = { createElement: node };
  try {
    renderQuestText(root, text, null, options);
    return root;
  } finally {
    globalThis.document = previous;
  }
}

function descendants(root) {
  const result = [],
    stack = [root];
  for (let index = 0; stack.length && index < 4096; index++) {
    const current = stack.pop();
    result.push(current);
    for (let child = current.children.length - 1; child >= 0; child--) {
      stack.push(current.children[child]);
    }
  }
  if (stack.length) throw new Error("Dialogue fixture node bound exceeded");
  return result;
}

function textContent(root) {
  return descendants(root)
    .map((entry) => entry.textContent)
    .join("");
}

test("choice delimiters do not leak hashes or invent paragraphs around authored newlines", () => {
  const root = render("Intro\\r\\n#b#L7#first#l#\\r\\n#L42#second#l", {
    interactive: true,
    dialogue: true,
  });
  expect(textContent(root)).toBe("Intro\nfirst\nsecond");
  const choices = descendants(root).filter(
    (entry) => entry.dataset.questChoice,
  );
  expect(choices.map((entry) => entry.dataset.questChoice)).toEqual([
    "7",
    "42",
  ]);
  expect(choices.map(textContent)).toEqual(["first", "second"]);
});

test("an unterminated original option ends at the next option without swallowing its reply ID", () => {
  // Quest/Say.img/1036/1/2 omits #l after both the Bowman and Thief alternatives.
  const root = render(
    "#L2# Bowman  -  Henesys \\r\\n#b#L3# Thief  -  Nautilus",
    {
      interactive: true,
      dialogue: true,
    },
  );
  const choices = descendants(root).filter(
    (entry) => entry.dataset.questChoice,
  );
  expect(choices.map((entry) => entry.dataset.questChoice)).toEqual(["2", "3"]);
  expect(choices.map(textContent)).toEqual([
    " Bowman  -  Henesys \n",
    " Thief  -  Nautilus",
  ]);
});

test("colon item icons and native quest banners become artwork rather than visible markup", () => {
  const root = render("#i4000018:# #t4000018:#\r\n#Wprob#", {
    resolver: (token) => (token === "#t4000018:#" ? "Firewood" : ""),
  });
  expect(textContent(root)).toBe(" Firewood\n");
  expect(
    descendants(root)
      .filter((entry) => entry.dataset.questArt)
      .map((entry) => entry.dataset.questArt),
  ).toEqual(["#i4000018:#", "#Wprob#"]);
});

test("long input prose keeps its body instead of losing another edit-control-height strip", () => {
  const geometry = dialogGeometry(300, "number");
  expect(geometry.scrolling).toBe(false);
  expect(geometry.textHeight).toBe(298);
  expect(geometry.y + geometry.textHeight).toBeLessThan(geometry.height - 26);
});

test("inline choice activation admits one keyboard click and blocks pending or repeated dispatch", () => {
  let clicks = 0;
  const choice = { tagName: "A", disabled: false, click: () => clicks++ };
  const view = { panel: { owner: { sound() {} } } };
  const event = {
    key: "Enter",
    repeat: false,
    target: { closest: () => choice },
    preventDefault() {},
    stopPropagation() {},
  };
  NativeDialogLayout.prototype.choiceKey.call(view, event);
  event.repeat = true;
  NativeDialogLayout.prototype.choiceKey.call(view, event);
  event.repeat = false;
  choice.disabled = true;
  NativeDialogLayout.prototype.choiceKey.call(view, event);
  expect(clicks).toBe(1);
});

test("NPC name line stays inside the original bar with visible lower padding", () => {
  const geometry = dialogGeometry(0, "say");
  const portrait = { width: 70, height: 31, origin: { x: 35, y: 31 } };
  const bar = { width: 121, height: 19, origin: { x: 0, y: 0 } };
  const position = dialogPortraitGeometry(geometry, portrait, bar);
  const topPadding = position.nameY - position.barY;
  const bottomPadding = position.barY + bar.height - (position.nameY + 14);
  expect(topPadding).toBe(2);
  expect(bottomPadding).toBe(3);
  expect(position.barY).toBeGreaterThan(position.y);
  expect(position.barY + bar.height).toBeLessThan(geometry.height - 58);
});

test("tall and right-side NPC portraits retain native footer clearance and name alignment", () => {
  const geometry = dialogGeometry(0, "say", 2);
  const portrait = { width: 109, height: 154, origin: { x: 54, y: 153 } };
  const bar = { width: 121, height: 19, origin: { x: 0, y: 0 } };
  const position = dialogPortraitGeometry(geometry, portrait, bar);
  const portraitBottom = position.y - portrait.origin.y + portrait.height;
  expect(position.barY - portraitBottom).toBe(13);
  expect(geometry.height - (position.barY + bar.height)).toBe(53);
  expect(position.nameX).toBe(position.barX);
  expect(position.nameX + 60).toBe(450);
  expect(position.barY + bar.height - (position.nameY + 14)).toBe(3);
});
