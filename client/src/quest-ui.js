const MAX_TEXT = 65536;
const PAGE_SIZE = 24;
const COLORS = {
  b: "#174ca4",
  r: "#b52020",
  g: "#236421",
  d: "#675171",
  k: "#222",
};
const TOKEN =
  /#L\d+#|#l|#h(?:0| )?#|#@\d+:#|#[ptomciavuz]\d+:?#|#[bgrdken]|#(?:f|F)[^#\r\n]+#/g;

function element(tag, text, className = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
}

function tokenText(token, quests) {
  const profile = quests.store.profile;
  if (token.startsWith("#h")) return profile.name;
  const id = Number(token.match(/\d+/)?.[0]);
  const code = token[1];
  if (code === "c") {
    return String(profile.inventory.find((item) => item.id === id)?.count ?? 0);
  }
  if (code === "u") return quests.catalog.records[id]?.name ?? token;
  if (code === "a") return monsterProgressText(token, id, quests);
  return catalogTokenText(token, id, quests);
}

function catalogTokenText(token, id, quests) {
  const code = token[1];
  const table = {
    "@": "npc",
    p: "npc",
    o: "mob",
    t: "item",
    m: "map",
    i: "item",
    v: "item",
    z: "item",
  }[code];
  if (table) return quests.catalog.strings[table][id] ?? token;
  return token;
}

function monsterProgressText(token, id, quests) {
  const profile = quests.store.profile;
  const questId = Math.trunc(id / 10),
    index = (id % 10) - 1;
  const mob = quests.catalog.records[questId]?.stages[1].check.mobs[index];
  return mob
    ? `${profile.quests[questId]?.kills[mob.id] ?? 0}/${mob.count}`
    : token;
}

/** No HTML injection or evaluated scripts; unsupported tokens remain visible original bytes. */
export function renderQuestText(container, raw, quests, interactive = false) {
  if (typeof raw !== "string" || raw.length > MAX_TEXT) {
    throw new Error("Quest text exceeds rendering policy");
  }
  const text = raw.replace(/\\r\\n|\\n|\\r|\r\n|\r/g, "\n");
  let target = container,
    position = 0,
    color = COLORS.k,
    bold = false;
  for (const match of text.matchAll(TOKEN)) {
    appendStyled(target, text.slice(position, match.index), color, bold);
    const token = match[0];
    if (token.startsWith("#L")) {
      target = element(interactive ? "button" : "span", "");
      if (interactive) {
        target.type = "button";
        target.dataset.questChoice = token.slice(2, -1);
        target.style.cssText =
          "display:block;text-align:left;background:transparent;border:0;padding:3px;color:inherit;font:inherit;cursor:pointer;";
      }
      container.append(target);
    } else if (token === "#l") target = container;
    else if (COLORS[token.slice(1)]) color = COLORS[token.slice(1)];
    else if (token === "#e" || token === "#n") bold = token === "#e";
    else appendStyled(target, tokenText(token, quests), color, bold);
    position = match.index + token.length;
  }
  appendStyled(target, text.slice(position), color, bold);
}

function appendStyled(target, text, color, bold) {
  if (!text) return;
  const span = element("span", text);
  span.style.color = color;
  span.style.fontWeight = bold ? "bold" : "normal";
  target.append(span);
}

function localNote(container, text) {
  const note = element("div", text);
  note.style.cssText =
    "font-size:11px;color:#5f5141;margin-top:5px;white-space:pre-wrap;";
  container.append(note);
}

function renderReasons(container, descriptor) {
  if (!descriptor.status.ok) {
    localNote(container, `Local availability: ${descriptor.status.reason}`);
  }
  if (descriptor.blockers.length) {
    const details = element("details", "");
    details.append(
      element(
        "summary",
        `Unsupported original rules (${descriptor.blockers.length})`,
      ),
    );
    for (const blocker of descriptor.blockers) {
      details.append(element("div", `${blocker.source}: ${blocker.reason}`));
    }
    container.append(details);
  }
  if (descriptor.unavailableBranches.length) {
    const details = element("details", "");
    details.append(
      element("summary", "Unavailable optional original dialogue branches"),
    );
    for (const branch of descriptor.unavailableBranches) {
      details.append(element("div", `${branch.source}: ${branch.reason}`));
    }
    container.append(details);
  }
  if (descriptor.dependencies.length) {
    const details = element("details", "");
    details.append(
      element("summary", "Required content and local acquisition boundaries"),
    );
    for (const dependency of descriptor.dependencies) {
      details.append(element("div", dependency));
    }
    container.append(details);
  }
}

/** Reuse original controls when the same UtilDlgEx is remounted for another NPC. */
function footer(panel) {
  if (panel.questFooter) return panel.questFooter;
  const controls = {};
  for (const [key, asset, x, label] of [
    ["back", "BtPrev", 24, "Previous page or return to local quest list"],
    ["next", "BtNext", 310, "Next original dialogue page"],
    ["yes", "BtQYes", 270, "Accept original quest transaction"],
    ["no", "BtQNo", 350, "Decline original quest offer"],
    ["ok", "BtOK", 350, "Acknowledge original quest dialogue"],
  ]) {
    controls[key] = panel.button(`UtilDlgEx/${asset}`, x, 176, {
      label,
      action: null,
    });
  }
  panel.questFooter = controls;
  return controls;
}

function hideFooter(controls) {
  for (const control of Object.values(controls)) control.setVisible(false);
}

function showControl(control, action, disabled = false) {
  control.options.action = action;
  control.setDisabled(disabled);
  control.setVisible(true);
}

function rewards(container, act, quests, session) {
  const text = [];
  if (act.exp) text.push(`EXP ${act.exp}`);
  if (act.money) text.push(`Meso ${act.money}`);
  if (act.pop) text.push(`Fame ${act.pop}`);
  if (text.length) {
    localNote(container, `Original Act rewards: ${text.join("; ")}`);
  }
  for (const item of act.items) {
    const name = quests.catalog.strings.item[item.id] ?? `#t${item.id}#`;
    localNote(
      container,
      `${name}: ${item.count > 0 ? "+" : ""}${item.count}${item.prop === -1 ? " (choose one)" : ""}`,
    );
  }
  renderRewardChoices(container, quests, session);
}

function renderRewardChoices(container, quests, session) {
  const choices = session?.snapshot().rewardChoices ?? [];
  if (!choices.length) return;
  const select = element("select", "");
  select.dataset.questReward = "true";
  select.setAttribute("aria-label", "Choose one original item reward");
  select.append(new Option("Select original reward", ""));
  for (const item of choices) {
    select.append(
      new Option(
        `${quests.catalog.strings.item[item.id] ?? item.id} × ${item.count}`,
        String(item.index),
      ),
    );
  }
  select.value =
    session.rewardIndex === null ? "" : String(session.rewardIndex);
  container.append(select);
}

function renderMenu(view) {
  const { panel, quests } = view;
  const rows = view.journal
    ? quests.journalRows()
    : (quests.byNpc.get(view.npcId) ?? []);
  const count = Math.ceil(rows.length / PAGE_SIZE);
  view.offset = Math.min(view.offset, Math.max(0, count - 1));
  localNote(
    panel.content,
    view.journal
      ? "Local quest journal — active, then completed, then other original quests"
      : "Local NPC quest selection — original WZ quest names and dialogue",
  );
  renderMenuHeading(view, rows.length);
  const end = Math.min(rows.length, (view.offset + 1) * PAGE_SIZE);
  for (let index = view.offset * PAGE_SIZE; index < end; index++) {
    renderMenuEntry(view, rows[index]);
  }
  renderMenuPaging(view, count);
}

function renderMenuHeading(view, rowCount) {
  const { content } = view.panel;
  if (view.npc?.name) content.append(element("strong", view.npc.name));
  if (view.error) localNote(content, `Local interaction: ${view.error}`);
  if (!rowCount) {
    localNote(
      content,
      "No original quest endpoint is encoded for this NPC. Missing scripts are not replaced with invented speech.",
    );
  }
}

function renderMenuEntry(view, record) {
  const state = view.quests.store.profile.quests[record.id]?.state ?? 0;
  const button = element("button", record.name ?? `Quest ${record.id}`);
  button.type = "button";
  button.dataset.questId = String(record.id);
  button.style.cssText =
    "display:block;text-align:left;width:100%;font:inherit;border:0;background:transparent;padding:4px;color:#21528c;cursor:pointer;";
  button.title = `Local state ${state}; ${record.supported ? "supported rule projection" : "unsupported original rules"}`;
  view.panel.content.append(button);
}

function renderMenuPaging(view, count) {
  const { panel } = view;
  if (count > 1) {
    localNote(panel.content, `Local list page ${view.offset + 1}/${count}`);
  }
  if (view.offset > 0) {
    showControl(view.controls.back, () => {
      view.offset--;
      refresh(view);
    });
  }
  if (view.offset + 1 < count) {
    showControl(view.controls.next, () => {
      view.offset++;
      refresh(view);
    });
  }
}

function renderJournal(view) {
  const record = view.quests.catalog.records[view.selected];
  const state = view.quests.store.profile.quests[record.id]?.state ?? 0;
  const descriptor = view.quests.describe(
    record,
    record.stages[Math.min(state, 1)].check.npc ?? 0,
  );
  view.panel.content.append(
    element("strong", descriptor.name ?? `Quest ${record.id}`),
  );
  localNote(
    view.panel.content,
    `Local state: ${["not started", "active", "completed"][state]}. Interact with the original NPC to accept or finish.`,
  );
  if (descriptor.journal) {
    renderQuestText(view.panel.content, descriptor.journal, view.quests);
  }
  if (descriptor.info?.demandSummary) {
    renderQuestText(
      view.panel.content,
      `\n${descriptor.info.demandSummary}`,
      view.quests,
    );
  }
  if (descriptor.info?.rewardSummary) {
    renderQuestText(
      view.panel.content,
      `\n${descriptor.info.rewardSummary}`,
      view.quests,
    );
  }
  renderReasons(view.panel.content, descriptor);
  rewards(view.panel.content, descriptor.rewards, view.quests, null);
  showControl(view.controls.back, () => {
    view.selected = null;
    refresh(view);
  });
}

function renderDialogue(view) {
  const state = view.session.snapshot();
  const { content } = view.panel;
  content.append(element("strong", state.name ?? `Quest ${state.questId}`));
  content.append(element("br", ""));
  const speaker =
    view.quests.catalog.strings.npc[view.session.say.npc ?? view.npcId];
  if (speaker) content.append(element("div", speaker));
  renderQuestText(content, state.text, view.quests, state.choices.length > 0);
  if (state.mode === "blocked") {
    renderReasons(
      content,
      view.quests.describe(view.session.record, view.npcId),
    );
  }
  renderTransactionResult(view, state);
  renderDialogueControls(view, state);
}

function renderTransactionResult(view, state) {
  const { content } = view.panel;
  if (view.error) localNote(content, `Local transaction: ${view.error}`);
  if (state.result?.ok) {
    localNote(
      content,
      `Local quest transaction committed once; state ${state.result.state}. ${view.quests.store.error ?? ""}`,
    );
  }
  if (state.result?.nextQuest) {
    const next = view.quests.catalog.records[state.result.nextQuest];
    localNote(
      content,
      `Original next quest: ${next?.name ?? state.result.nextQuest}. Select it at its encoded NPC endpoint.`,
    );
  }
}

function renderDialogueControls(view, state) {
  const { content } = view.panel;
  showControl(view.controls.back, () => previous(view));
  if (state.mode === "confirm") {
    rewards(
      content,
      view.session.record.stages[state.stage].act,
      view.quests,
      view.session,
    );
    showControl(view.controls.yes, () => accept(view));
    showControl(view.controls.no, () => {
      view.session.reject();
      refresh(view);
    });
  } else if (state.mode === "offer") {
    if (!state.choices.length) {
      showControl(view.controls.next, () => advance(view));
    }
    showControl(view.controls.no, () => {
      view.session.reject();
      refresh(view);
    });
  } else if (!state.finalPage) {
    showControl(view.controls.next, () => advance(view));
  } else {
    showControl(view.controls.ok, () => {
      view.session = null;
      refresh(view);
    });
  }
}

/** A retained dialog cannot authorize another field, a dead player or a distant NPC. */
function admit(view) {
  if (view.npc?.canInteract?.() === true) return true;
  view.error =
    "This original NPC is no longer interactable in the current field. Move nearby and reopen the dialogue.";
  refresh(view);
  return false;
}

function previous(view) {
  if (!view.session?.previous()) view.session = null;
  refresh(view);
}

function advance(view, choice = null) {
  if (!admit(view)) return;
  const result = view.session.advance(choice);
  view.error = result.ok ? null : result.reason;
  refresh(view);
}

function accept(view) {
  if (!admit(view)) return;
  const result = view.session.accept();
  view.error = result.ok ? null : result.reason;
  refresh(view);
}

function refresh(view) {
  if (view.destroyed) return;
  view.panel.content.replaceChildren();
  hideFooter(view.controls);
  if (view.journal && view.selected) renderJournal(view);
  else if (view.session) renderDialogue(view);
  else renderMenu(view);
}

function handleClick(view, event) {
  const button = event.target.closest("button");
  if (!button || !view.panel.content.contains(button)) return;
  if (!view.journal && !admit(view)) return;
  if (button.dataset.questId) {
    view.error = null;
    if (view.journal) view.selected = Number(button.dataset.questId);
    else {
      view.session = view.quests.openDialogue(
        Number(button.dataset.questId),
        view.npcId,
      );
    }
    refresh(view);
  } else if (button.dataset.questChoice !== undefined && view.session) {
    advance(view, Number(button.dataset.questChoice));
  }
}

function mount(panel, quests, npc, journal) {
  const npcId = npc ? Number(npc.templateId) : 0;
  const view = {
    panel,
    quests,
    npc,
    npcId,
    journal,
    offset: 0,
    selected: null,
    session: null,
    error: null,
    controls: footer(panel),
    destroyed: false,
  };
  panel.content.style.whiteSpace = "pre-wrap";
  const click = (event) => handleClick(view, event);
  const change = (event) => {
    if (event.target.dataset.questReward && view.session) {
      view.session.rewardIndex =
        event.target.value === "" ? null : Number(event.target.value);
    }
  };
  panel.content.addEventListener("click", click);
  panel.content.addEventListener("change", change);
  refresh(view);
  const cleanup = () => {
    view.destroyed = true;
    panel.content.removeEventListener("click", click);
    panel.content.removeEventListener("change", change);
    hideFooter(view.controls);
    for (const control of Object.values(view.controls)) {
      control.options.action = null;
    }
    panel.content.replaceChildren();
  };
  cleanup.refresh = () => refresh(view);
  return cleanup;
}

/** Main wires this into GameUI hooks.onNpcDialogue after original UtilDlgEx chrome. */
export function mountNpcDialogue(panel, npc, quests) {
  return mount(panel, quests, npc, false);
}

/** Read-only journal; quest authority always requires the original NPC interaction. */
export function mountQuestJournal(panel, quests) {
  return mount(panel, quests, null, true);
}
