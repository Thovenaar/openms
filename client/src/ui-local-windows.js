import { layoutWorldMap } from "./ui-worldmap.js";
import { renderQuestText } from "./quest-ui.js";

export const LOCAL_WINDOW_NAMES = Object.freeze([
  "WorldMap",
  "UserList",
  "QuestAlarm",
  "MonsterBook",
  "PartySearch",
  "Family",
  "Title",
  "Messenger",
]);
const PAGE_SIZE = 8;
const MAX_QUESTS = 16384;
const MAX_TEMPLATES = 4096;
const USER_TABS = ["Friends", "Party", "Guild", "Blacklist", "Guild Union"];

export function localWindowSize(name, resource) {
  if (!LOCAL_WINDOW_NAMES.includes(name)) return null;
  if (name === "WorldMap") return [654, 521];
  if (name === "QuestAlarm") return [223, 246];
  const background = resource.manifest.metadata.assets[`${name}/backgrnd`];
  if (!background) {
    throw new Error(`Missing original ${name} window background`);
  }
  return [background.width, background.height];
}

function line(content, text, strong = false) {
  const node = document.createElement(strong ? "strong" : "div");
  node.textContent = text;
  content.append(node);
  return node;
}

function refuse(panel, operation, dependency) {
  panel.localContent.replaceChildren();
  line(panel.localContent, `${operation} unavailable offline`, true);
  line(panel.localContent, dependency);
  panel.owner.status(`${operation} unavailable: ${dependency}`);
  return { ok: false, code: "server-required", reason: dependency };
}

function remoteButton(panel, { path, label, x, y, reason }) {
  if (!panel.assets[`${path}/normal/0`]) {
    throw new Error(`Missing original operation button ${path}`);
  }
  panel.button(path, x, y, {
    label,
    action: () => refuse(panel, label, reason),
  });
}

function profileHeading(panel, content) {
  const profile = panel.owner.store?.profile;
  if (!profile) {
    line(content, "Local profile is unavailable.");
    return;
  }
  line(content, `${profile.name} — Level ${profile.level}`, true);
  line(
    content,
    `Current field: ${panel.owner.scene?.manifest.id ?? "not loaded"}`,
  );
}

function userTab(panel, index) {
  if (!Number.isInteger(index) || index < 0 || index >= USER_TABS.length) {
    throw new Error("Invalid native UserList tab");
  }
  panel.localTab = index;
  panel.userTabLayer?.destroy();
  const layer = panel.layer("UserListTabs");
  panel.userTabLayer = layer;
  let x = 12;
  for (let i = 0; i < USER_TABS.length; i++) {
    const path = `UserList/Tab/${i === index ? "enabled" : "disabled"}/${i}`;
    const asset = panel.assets[path];
    layer.image(path, x, 24);
    layer.hit(
      USER_TABS[i],
      { x, y: 24, width: asset.width, height: asset.height },
      { click: () => userTab(panel, i) },
    );
    x += asset.width;
  }
  layer.localContent = panel.localContent;
  if (index === 0) {
    remoteButton(layer, {
      path: "UserList/Friend/BtAddFriend",
      label: "Add friend",
      x: 20,
      y: 340,
      reason:
        "A server friend registry and a real remote character are required.",
    });
  }
  if (index === 1) {
    remoteButton(layer, {
      path: "UserList/Party/BtCreate",
      label: "Create party",
      x: 20,
      y: 340,
      reason:
        "A server party registry is required; local identity is not party membership.",
    });
  }
  if (index === 2) {
    remoteButton(layer, {
      path: "UserList/Guild/GuildInfo/BtInvite",
      label: "Invite to guild",
      x: 20,
      y: 340,
      reason:
        "Guild membership, invitation authority and a real remote character are required.",
    });
  }
  refreshUserList(panel);
  panel.renderArtwork();
}

function refreshUserList(panel) {
  const content = panel.localContent;
  content.replaceChildren();
  profileHeading(panel, content);
  line(content, `${USER_TABS[panel.localTab]}: 0`, true);
  const notes = [
    "No server friend list or online-presence service is connected. Your local character is not a remote friend.",
    "No party membership. Create/invite/join require server party authority; no synthetic party is created.",
    "No guild membership. Guild creation, invitations and ranks require a server guild registry.",
    "No remote blacklist records. No remote recipients are available to block.",
    "No guild union membership. Alliance records require the server guild registry.",
  ];
  line(content, notes[panel.localTab]);
}

function userList(panel) {
  panel.localContent = panel.contentArea(20, 80, 272, 230);
  panel.selectLocalTab = (index) => userTab(panel, index);
  panel.localRefresh = () => refreshUserList(panel);
  userTab(panel, 0);
}

function activeQuests(panel) {
  const quests = panel.owner.quests;
  if (!quests) return [];
  const entries = Object.entries(quests.store.profile.quests);
  if (entries.length > MAX_QUESTS) {
    throw new Error("Quest tracker bound exceeded");
  }
  return entries.filter(([, state]) => state.state === 1);
}

function appendTrackedQuest(panel, id, state) {
  const content = panel.localContent;
  const quests = panel.owner.quests;
  const record = quests.catalog.records[id];
  line(content, record?.name || `Quest ${id}`, true);
  if (!record) {
    line(content, "Original quest record is unavailable.");
    return;
  }
  const stage = record.stages[1];
  for (const mob of stage.check.mobs) {
    line(
      content,
      `Monster ${mob.id}: ${state.kills[mob.id] ?? 0}/${mob.count}`,
    );
  }
  for (const item of stage.check.items) {
    const profile = quests.store.profile;
    const count =
      (profile.inventory.find((entry) => entry.id === item.id)?.count ?? 0) +
      Number(profile.equipment.includes(item.id));
    line(
      content,
      `${panel.owner.index.itemLabels[item.id] || item.id}: ${count}; required ${item.count}`,
    );
  }
  const description = quests.describe(record, stage.check.npc ?? 0);
  if (description.journal) {
    renderQuestText(content, description.journal, quests);
  }
}

function refreshTracker(panel) {
  const content = panel.localContent;
  content.replaceChildren();
  const active = activeQuests(panel);
  panel.localPage = Math.min(
    panel.localPage,
    Math.max(0, Math.ceil(active.length / PAGE_SIZE) - 1),
  );
  line(
    content,
    `${active.length} active local quest${active.length === 1 ? "" : "s"}`,
    true,
  );
  if (!active.length) {
    line(
      content,
      "Accept a quest from its original NPC to track its progress here.",
    );
  }
  for (
    let i = panel.localPage * PAGE_SIZE;
    i < Math.min(active.length, (panel.localPage + 1) * PAGE_SIZE);
    i++
  ) {
    const [id, state] = active[i];
    appendTrackedQuest(panel, id, state);
  }
  panel.localPages = Math.max(1, Math.ceil(active.length / PAGE_SIZE));
}

function tracker(panel) {
  panel.image("QuestAlarm/backgrndmax", 0, 0);
  for (let y = 25; y < 241; y += 18) {
    panel.image("QuestAlarm/backgrndcenter", 0, y);
  }
  panel.image("QuestAlarm/backgrndbottom", 0, 241);
  panel.localContent = panel.contentArea(12, 29, 199, 173);
  panel.localPage = 0;
  panel.localRefresh = () => refreshTracker(panel);
  panel.localButton("Previous", 12, 209, () => {
    panel.localPage = Math.max(0, panel.localPage - 1);
    refreshTracker(panel);
  });
  panel.localButton("Next", 90, 209, () => {
    panel.localPage = Math.min(panel.localPages - 1, panel.localPage + 1);
    refreshTracker(panel);
  });
  refreshTracker(panel);
}

function refreshMonsterBook(panel) {
  const content = panel.localContent;
  content.replaceChildren();
  line(content, "Registered monster cards: 0", true);
  line(
    content,
    "Card registration is not implemented in the local profile. Field information below is original WZ data, not an unlocked card collection.",
  );
  const templates = Object.values(
    panel.owner.scene?.manifest.life?.templates || {},
  );
  if (templates.length > MAX_TEMPLATES) {
    throw new Error("Monster catalog bound exceeded");
  }
  const mobs = templates.filter((template) => template.kind === "mob");
  panel.localPages = Math.max(1, Math.ceil(mobs.length / PAGE_SIZE));
  panel.localPage = Math.min(panel.localPage, panel.localPages - 1);
  for (
    let i = panel.localPage * PAGE_SIZE;
    i < Math.min(mobs.length, (panel.localPage + 1) * PAGE_SIZE);
    i++
  ) {
    const mob = mobs[i];
    line(content, mob.name || `Monster ${mob.originalId}`, true);
    line(
      content,
      `Level ${mob.info.level ?? "unknown"} · HP ${mob.info.maxHP ?? "unknown"} · EXP ${mob.info.exp ?? "unknown"}`,
    );
  }
  if (!mobs.length) {
    line(content, "This field has no extracted monster templates.");
  }
}

function monsterBook(panel) {
  panel.localContent = panel.contentArea(34, 48, 404, 250);
  panel.localPage = 0;
  panel.localRefresh = () => refreshMonsterBook(panel);
  panel.button("MonsterBook/arrowLeft", 183, 308, {
    label: "Previous field monsters",
    action: () => {
      panel.localPage = Math.max(0, panel.localPage - 1);
      refreshMonsterBook(panel);
    },
  });
  panel.button("MonsterBook/arrowRight", 267, 308, {
    label: "Next field monsters",
    action: () => {
      panel.localPage = Math.min(panel.localPages - 1, panel.localPage + 1);
      refreshMonsterBook(panel);
    },
  });
  refreshMonsterBook(panel);
}

function refreshRemote(panel) {
  const content = panel.localContent;
  content.replaceChildren();
  profileHeading(panel, content);
  const notes = {
    Family:
      "Family members: 0\nReputation: 0\nNo family membership. Family trees, juniors and reputation privileges require server family records.",
    PartySearch:
      "Search results: 0\nNo party-search service is connected. Local monsters/NPCs are not party candidates. Registration and matchmaking require real remote players.",
    Messenger:
      "Remote participants: 0\nNo messenger session. Inviting, entering or sending messages requires a server session and real recipient. Use local chat for offline text.",
    Title:
      "Medal ownership is shown only from actual inventory below. Challenge ranking and medal claim/reissue require server quest/ranking authority.",
  };
  line(content, notes[panel.name]);
  if (panel.name === "Title") showMedals(panel, content);
}

function showMedals(panel, content) {
  const profile = panel.owner.store?.profile;
  if (!profile) return;
  // Original Character/Accessory/0114xxxx.img is the medal item family.
  const ids = new Set(profile.equipment);
  for (const item of profile.inventory) ids.add(item.id);
  let count = 0;
  for (const id of ids) {
    if (Math.trunc(id / 10000) !== 114) continue;
    line(content, panel.owner.index.itemLabels[id] || `Medal ${id}`);
    count++;
  }
  line(content, `Owned medals: ${count}`, true);
}

function remoteWindow(panel) {
  panel.localContent = panel.contentArea(
    18,
    60,
    panel.width - 36,
    panel.height - 130,
  );
  panel.localRefresh = () => refreshRemote(panel);
  const operations = {
    Family: [
      "BtJuniorEntry",
      "Add junior",
      "A family service and another real character in the same field/channel are required.",
    ],
    PartySearch: [
      "BtReg",
      "Register party search",
      "Server party search and real remote players are required.",
    ],
    Messenger: [
      "BtEnter",
      "Enter messenger",
      "A server messenger session and real recipient are required.",
    ],
    Title: [
      "BtOK",
      "Claim medal",
      "The original medal quest/ranking server must authorize the claim. No item was granted.",
    ],
  };
  const [button, label, reason] = operations[panel.name];
  remoteButton(panel, {
    path: `${panel.name}/${button}`,
    label,
    x: 20,
    y: panel.height - 50,
    reason,
  });
  refreshRemote(panel);
}

/** Native artwork remains native; contextual offline bodies explicitly distinguish local and remote authority. */
export function layoutLocalWindow(panel) {
  if (!LOCAL_WINDOW_NAMES.includes(panel.name)) return false;
  if (panel.name === "WorldMap") layoutWorldMap(panel);
  else if (panel.name === "QuestAlarm") tracker(panel);
  else {
    panel.image(`${panel.name}/backgrnd`, 0, 0);
    if (panel.name === "UserList") userList(panel);
    else if (panel.name === "MonsterBook") monsterBook(panel);
    else remoteWindow(panel);
  }
  return true;
}
