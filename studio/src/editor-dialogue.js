import { element, field, input, text, select, button, section } from "./dom.js";
import { original } from "./models.js";

const MAX_NODES = 16;
const MAX_OPTIONS = 6;
const MAX_TEXT = 512;
const MAX_LABEL = 64;

export function dialogueEditor(app) {
  const value = app.draft.definition;
  return [
    targetSection(app, value),
    conversationSection(app, value),
    previewSection(value),
  ];
}

function targetSection(app, value) {
  const ref = value.target;
  const choices = element("select", {
    class: "form-select",
    "aria-label": "NPCs in the source map",
    onchange: (event) => {
      value.target = original("npc", event.target.value, ref.mapId);
      app.changed();
      app.renderEditor();
    },
  });
  const load = async () => {
    const { manifest } = await app.api.resolve(original("map", ref.mapId));
    const templates = Object.values(manifest.life.templates).filter(
      (row) => row.kind === "npc",
    );
    choices.replaceChildren(
      ...templates.map((row) =>
        element("option", {
          value: String(Number(row.originalId)),
          text: `${row.name} · ${Number(row.originalId)}`,
        }),
      ),
    );
    choices.value = String(ref.id);
  };
  const id = (key, label) =>
    field(
      label,
      input(ref[key], (next) => {
        ref[key] = next;
        app.changed();
      }),
    );
  return section(
    "NPC",
    [
      element("div", { class: "form-grid" }, [
        id("mapId", "Source map ID"),
        id("id", "NPC ID"),
      ]),
      element("div", { class: "tool-grid" }, [
        button("Browse NPCs in map", () => app.run(load), "secondary"),
      ]),
      choices,
      element("small", { class: "hint", text: app.npcLabel ?? "" }),
    ],
    "This conversation replaces whatever the NPC would otherwise say, until you remove it from the release.",
  );
}

function conversationSection(app, value) {
  const reachable = reachableNodes(value);
  return section(
    "Conversation",
    [
      element("div", { class: "form-grid" }, [
        field(
          "Start at",
          select(
            value.start,
            value.nodes.map((node) => [node.id, `Node ${node.id}`]),
            (next) => {
              value.start = Number(next);
              app.changed();
              app.renderEditor();
            },
            { disabled: value.nodes.length < 2 },
          ),
        ),
      ]),
      ...value.nodes.map((node, index) =>
        nodeCard(app, value, node, {
          index,
          reachable: reachable.has(node.id),
        }),
      ),
      button("Add node", () => addNode(app, value)),
      element("p", {
        class: "hint",
        text: `${value.nodes.length} of ${MAX_NODES} nodes. Every reply ends the conversation or continues to another node.`,
      }),
    ],
    "Each node is one message with up to six replies the player can choose.",
  );
}

function nodeCard(app, value, node, at) {
  return element("div", { class: "npc-editor" }, [
    nodeHeader(app, value, node, at),
    field(
      "Message",
      text(node.text, (next) => {
        node.text = next.slice(0, MAX_TEXT);
        app.changed();
      }),
      `${node.text.length} of ${MAX_TEXT} characters. Plain text only.`,
    ),
    ...node.options.map((option, index) =>
      optionRow(app, value, node, { option, index }),
    ),
    button("Add reply", () => addReply(app, node)),
  ]);
}

function nodeHeader(app, value, node, at) {
  return element("div", { class: "section-heading" }, [
    element("strong", { text: `Node ${node.id}` }),
    ...(node.id === value.start
      ? [element("span", { class: "badge published", text: "start" })]
      : [
          button(
            "Start here",
            () => {
              value.start = node.id;
              app.changed();
              app.renderEditor();
            },
            "subtle",
          ),
        ]),
    ...(at.reachable
      ? []
      : [
          element("span", {
            class: "badge draft",
            text: "not reachable from the start",
          }),
        ]),
    ...(value.nodes.length > 1
      ? [
          button(
            "Remove node",
            () => {
              removeNode(value, at.index);
              app.changed();
              app.renderEditor();
            },
            "danger",
          ),
        ]
      : []),
  ]);
}

function optionRow(app, value, node, entry) {
  return element("div", { class: "objective-row" }, [
    field(
      "Player reply",
      input(
        entry.option.label,
        (next) => {
          entry.option.label = next.slice(0, MAX_LABEL);
          app.changed();
        },
        { maxLength: MAX_LABEL },
      ),
    ),
    field(
      "Then",
      select(
        entry.option.next === null ? "end" : String(entry.option.next),
        [
          ["end", "End the conversation"],
          ...value.nodes
            .filter((row) => row.id !== node.id)
            .map((row) => [String(row.id), `Go to node ${row.id}`]),
        ],
        (next) => {
          entry.option.next = next === "end" ? null : Number(next);
          app.changed();
          app.renderEditor();
        },
      ),
    ),
    button(
      "Remove reply",
      () => {
        node.options.splice(entry.index, 1);
        app.changed();
        app.renderEditor();
      },
      "danger",
    ),
  ]);
}

function addNode(app, value) {
  if (value.nodes.length >= MAX_NODES) {
    throw new Error(`A conversation supports at most ${MAX_NODES} nodes.`);
  }
  const id = value.nodes.length;
  const previous = value.nodes[id - 1];
  if (previous && !previous.options.length) {
    previous.options.push({ label: "Continue", next: id });
  }
  value.nodes.push({ id, text: "", options: [] });
  app.changed();
  app.renderEditor();
}

function addReply(app, node) {
  if (node.options.length >= MAX_OPTIONS) {
    throw new Error(`A node supports at most ${MAX_OPTIONS} replies.`);
  }
  node.options.push({ label: "Next", next: null });
  app.changed();
  app.renderEditor();
}

function previewSection(value) {
  const lines = [];
  const seen = new Set();
  let current = value.nodes.find((node) => node.id === value.start);
  while (current && !seen.has(current.id) && lines.length < MAX_NODES * 2) {
    seen.add(current.id);
    lines.push(
      element("p", { class: "hint" }, [
        element("strong", { text: "NPC: " }),
        element("span", { text: current.text || "(empty message)" }),
      ]),
    );
    for (const option of current.options) {
      lines.push(
        element("p", { class: "hint" }, [
          element("span", {
            text: `  ↳ ${option.label || "(empty reply)"} → `,
          }),
          element("strong", {
            text: option.next === null ? "end" : `node ${option.next}`,
          }),
        ]),
      );
    }
    const next = current.options.find((option) => option.next !== null);
    current = next
      ? value.nodes.find((node) => node.id === next.next)
      : undefined;
  }
  return section(
    "Player view",
    lines.length
      ? lines
      : [element("p", { class: "hint", text: "The start node is empty." })],
    "The first path through the conversation, as a player would see it.",
  );
}

/** Node ids stay dense: removing one rewrites every reference to it. */
function removeNode(value, index) {
  for (const node of value.nodes) {
    for (const option of node.options) {
      if (option.next === index) option.next = null;
      else if (option.next > index) option.next -= 1;
    }
  }
  value.nodes.splice(index, 1);
  value.nodes.forEach((node, id) => {
    node.id = id;
  });
  if (value.start === index) value.start = 0;
  else if (value.start > index) value.start -= 1;
  value.start = Math.min(value.start, value.nodes.length - 1);
}

function reachableNodes(value) {
  const reached = new Set();
  const queue = [value.start];
  while (queue.length && reached.size <= MAX_NODES) {
    const id = queue.shift();
    if (reached.has(id)) continue;
    reached.add(id);
    const node = value.nodes.find((row) => row.id === id);
    for (const option of node?.options ?? []) {
      if (option.next !== null) queue.push(option.next);
    }
  }
  return reached;
}
