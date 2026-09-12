const MAX_TEXT = 24000;
const MAX_QUEST_ROWS = 128;
const MAX_QUEST_ENTRIES = 16384;
const MAX_OBJECTIVES = 32;
const SECTIONS = [
  ["quests", "Quests"],
  ["connection", "Connection"],
  ["content", "Content identity"],
  ["prediction", "Input/prediction"],
  ["operations", "Operations/events"],
  ["peers", "Peers/session"],
];
const CONNECTION_FIELDS = [
  "status",
  "serverTick",
  "inputSeq",
  "lastEventSeq",
  "pendingOperations",
  "queuedMessages",
  "queuedBytes",
  "bufferedBytes",
];

/** Inspection serialization is bounded and never changes the observed model. */
export function inspectionText(value) {
  if (value === undefined || value === null) {
    return "Not available in this session.";
  }
  const text = JSON.stringify(value, null, 2);
  return text.length > MAX_TEXT
    ? `${text.slice(0, MAX_TEXT)}\n[Display limit reached; refine the observation.]`
    : text;
}

export function inspectionElement(parent, tag, text = "") {
  const element = parent.ownerDocument.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

function addAction(parent, label, action, state) {
  const button = inspectionElement(parent, "button", label);
  button.type = "button";
  button.disabled = !state.command;
  button.addEventListener(
    "click",
    async () => {
      button.disabled = true;
      try {
        const result = await state.command(
          typeof action === "function" ? action() : action,
        );
        state.status.textContent = inspectionText(result);
      } catch (error) {
        state.status.textContent = `Refused: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    },
    { signal: state.signal },
  );
  return button;
}

function questAction(row, kind) {
  return {
    kind,
    questId: row.entry.id,
    conversationId: row.offer?.conversationId,
    step: row.offer?.step,
  };
}

function createQuestRow(parent, state) {
  const root = inspectionElement(parent, "article");
  const title = inspectionElement(root, "h4");
  const status = inspectionElement(root, "p");
  const objectives = inspectionElement(root, "p");
  const actions = inspectionElement(root, "div");
  actions.className = "state-testing-actions";
  const row = { root, title, status, objectives, entry: null, offer: null };
  row.abandon = addAction(
    actions,
    "Abandon…",
    () => questAction(row, "inspection.quest-abandon"),
    state,
  );
  row.accept = addAction(
    actions,
    "Accept offered quest",
    () => questAction(row, "inspection.quest-accept"),
    state,
  );
  row.claim = addAction(
    actions,
    "Claim offered reward",
    () => questAction(row, "inspection.quest-claim"),
    state,
  );
  return row;
}

function objectiveLine(item) {
  if (item.text) return item.text;
  const label = item.label ?? item.kind ?? "Objective";
  const current = item.current ?? item.count ?? "?";
  const required = item.required ?? item.total ?? "?";
  return `${label} ${item.templateId ?? ""}: ${current}/${required}`;
}

function objectiveText(objectives) {
  if (!Array.isArray(objectives)) return "No objective details published.";
  const rows = [];
  for (
    let index = 0;
    index < Math.min(objectives.length, MAX_OBJECTIVES);
    index++
  ) {
    rows.push(objectiveLine(objectives[index]));
  }
  if (objectives.length > MAX_OBJECTIVES) {
    rows.push("Further objectives: open native quest journal.");
  }
  return rows.join("\n") || "No counted objectives.";
}

function updateQuestRow(row, entry, offer) {
  row.entry = entry;
  row.offer = offer;
  row.title.textContent = `${entry.name ?? "Quest"} [${entry.id}]`;
  const states = { 0: "Available", 1: "Active", 2: "Completed" };
  row.status.textContent = `${states[entry.state] ?? entry.state} · ${entry.ready ? "Ready" : "Not ready"}${entry.reason ? ` · ${entry.reason}` : ""}`;
  row.objectives.textContent = objectiveText(entry.objectives);
  row.abandon.hidden =
    ![1, "active"].includes(entry.state) || entry.giveUp === false;
  const offered = offer?.quests?.find((value) => value.questId === entry.id);
  row.accept.hidden = offered?.action !== "accept";
  row.claim.hidden = offered?.action !== "claim";
}

function observedQuestMatches(value, query) {
  const entries = value?.entries ?? [];
  if (!Array.isArray(entries) || entries.length > MAX_QUEST_ENTRIES) {
    throw new Error("Quest observation exceeds the inspection bound.");
  }
  return entries.filter((entry) =>
    `${entry.name ?? ""} ${entry.id}`.toLowerCase().includes(query),
  );
}

function questSearchSummary(matched, mode) {
  if (matched > MAX_QUEST_ROWS) {
    return `${matched} matches; first ${MAX_QUEST_ROWS} shown. Refine the search.`;
  }
  const action =
    mode === "online"
      ? "Accept/claim require a current server NPC offer."
      : "Open the native journal for quest actions.";
  return `${matched} observed quests. ${action}`;
}

function mountQuests(root, state) {
  addAction(
    root,
    "Open native Quest journal",
    { kind: "inspection.quest-journal" },
    state,
  );
  const filter = inspectionElement(root, "input");
  filter.type = "search";
  filter.placeholder = "Quest name or ID";
  filter.maxLength = 120;
  filter.setAttribute("aria-label", "Filter observed quests");
  const status = inspectionElement(root, "p");
  const list = inspectionElement(root, "div");
  const rows = new Map();
  let value = null;
  function refresh(next = value) {
    value = next;
    const matches = observedQuestMatches(
      value,
      filter.value.trim().toLowerCase(),
    );
    const visible = new Set();
    for (const entry of matches.slice(0, MAX_QUEST_ROWS)) {
      visible.add(entry.id);
      let row = rows.get(entry.id);
      if (!row) {
        row = createQuestRow(list, state);
        rows.set(entry.id, row);
      }
      updateQuestRow(row, entry, value.offer);
      if (state.mode === "offline") row.abandon.hidden = true;
    }
    for (const [id, row] of rows) {
      if (!visible.has(id)) {
        row.root.remove();
        rows.delete(id);
      }
    }
    status.textContent = questSearchSummary(matches.length, state.mode);
  }
  filter.addEventListener("input", () => refresh(), { signal: state.signal });
  return refresh;
}

function mountConnection(root) {
  const fields = new Map();
  const list = inspectionElement(root, "dl");
  for (const key of CONNECTION_FIELDS) {
    inspectionElement(
      list,
      "dt",
      key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`),
    );
    fields.set(key, inspectionElement(list, "dd"));
  }
  return (value) => {
    for (const [key, output] of fields) {
      output.textContent = String(value?.[key] ?? "Not applicable");
    }
  };
}

/** Mount once. read supplies bounded {quests:{entries,offer},connection,content,
 * prediction,operations,peers}. Commands are explicit inspection actions. */
export function mountStateTesting({ root, mode, read, command, signal }) {
  if (!["online", "offline"].includes(mode)) {
    throw new Error("Unknown authority mode");
  }
  const panel = inspectionElement(root, "section");
  panel.className = "state-testing";
  inspectionElement(
    panel,
    "p",
    mode === "online"
      ? "Server authority · observations are read-only; requests are validated by the server."
      : "Offline authority · local observations; no server requests.",
  );
  const status = inspectionElement(panel, "p");
  status.setAttribute("role", "status");
  const state = { mode, command, signal, status };
  const outputs = new Map();
  const views = new Map();
  for (const [key, title] of SECTIONS) {
    const section = inspectionElement(panel, "section");
    inspectionElement(section, "h3", title);
    if (key === "quests") views.set(key, mountQuests(section, state));
    if (key === "connection") views.set(key, mountConnection(section));
    const details = inspectionElement(section, "details");
    inspectionElement(details, "summary", "Technical observation");
    outputs.set(key, inspectionElement(details, "pre"));
  }
  if (mode === "online" && command) {
    const actions = inspectionElement(panel, "div");
    actions.className = "state-testing-actions";
    addAction(
      actions,
      "Request authoritative resync",
      { kind: "inspection.resync" },
      state,
    );
    addAction(
      actions,
      "Reconnect session",
      { kind: "inspection.reconnect" },
      state,
    );
  }
  function refresh() {
    const value = read();
    for (const [key, output] of outputs) {
      const text = inspectionText(value?.[key]);
      if (output.textContent !== text) output.textContent = text;
      views.get(key)?.(value?.[key]);
    }
  }
  refresh();
  return { refresh, destroy: () => panel.remove() };
}
