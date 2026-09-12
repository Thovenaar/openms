import {
  socialView,
  replaceSocialLayer,
  socialText,
  socialButton,
  socialList,
  socialTabs,
  admitted,
  requestTarget,
  requestText,
  confirmSocial,
  socialPrompt,
  socialHook,
  memberText,
  socialMemberRow,
  socialColumns,
  socialRoster,
  appendSocialSection,
} from "./ui-social-controls.js";
import {
  drawGuild,
  drawGuildBoard,
  drawGuildEditor,
} from "./ui-social-guild.js";
import { SOCIAL_LIMITS } from "../profile/profile-social.js";

// UI/UserList/Tab/{enabled,disabled}/0..4; 0091d99d selects the backgrounds below.
const TABS = ["Buddy", "Party", "Guild", "Guild Alliance", "Blacklist"];
const BACKGROUNDS = [
  "backgrnd3",
  "backgrnd",
  "backgrnd2",
  "backgrnd2",
  "backgrnd",
];

/** Native009196f2/00919b73/0091cf4f: five tabs share one normal window owner. */
export function layoutUserList(panel, social) {
  const state = socialView(panel, social, drawUserList);
  state.onlineOnly = false;
  state.collapsedGroups = new Set();
  panel.localTab = panel.owner.restoreTab("UserList", [0, 1, 2, 3, 4]);
  panel.selectLocalTab = (tab) => {
    if (!Number.isInteger(tab) || tab < 0 || tab >= TABS.length) {
      throw new Error("Invalid UserList tab");
    }
    panel.localTab = tab;
    panel.owner.rememberTab("UserList", tab);
    state.selected = null;
    state.position = 0;
    state.mode = null;
    state.refresh();
  };
  state.refresh();
}

function drawUserList(state) {
  validateUserListMode(state);
  if (state.mode === "board") return drawGuildBoard(state);
  if (state.mode === "guild-edit" || state.mode === "emblem") {
    return drawGuildEditor(state);
  }
  const tab = state.panel.localTab;
  state.panel.width = 312;
  state.panel.height = 389;
  state.panel.element.style.width = "312px";
  state.panel.element.style.height = "389px";
  if (state.panel.dragStrip) state.panel.dragStrip.style.width = "288px";
  state.panel.closeControl?.position(295, 6);
  replaceSocialLayer(state, `UserList/${BACKGROUNDS[tab]}`);
  socialTabs(state, {
    path: "UserList/Tab",
    x: 6,
    y: 23,
    nativeSpan: 270,
    labels: TABS,
    selected: tab,
    select: state.panel.selectLocalTab,
  });
  if (tab === 0) drawFriends(state);
  else if (tab === 1) drawParty(state);
  else if (tab === 4) drawBlacklist(state);
  else drawGuild(state, tab === 3);
  state.restoreFocus();
}

function validateUserListMode(state) {
  if (state.mode === "board" && !state.view.guild) state.mode = null;
  if (
    (state.mode === "guild-edit" || state.mode === "emblem") &&
    !state.view[state.panel.localTab === 3 ? "alliance" : "guild"]
  ) {
    state.mode = null;
  }
}

function selectedMember(state) {
  return state.view.participants.find((member) => member.id === state.selected);
}

function selectedPayload(state) {
  return { targetId: selectedMember(state)?.id };
}

function friendRows(state) {
  const rows = [];
  const groups = new Map();
  for (const name of state.view.friendGroups) groups.set(name, []);
  for (const friend of state.view.friends) {
    if (!groups.has(friend.group)) groups.set(friend.group, []);
    groups.get(friend.group).push(friend);
  }
  for (const [name, members] of groups) {
    const online = members.filter((member) => member.online);
    const visible = state.onlineOnly ? online : members;
    rows.push({
      id: `group:${name}`,
      group: name,
      groupHeader: true,
      name: `${state.collapsedGroups.has(name) ? "+" : "−"} ${name}`,
      count: `(${online.length}/${members.length})`,
    });
    if (state.collapsedGroups.has(name)) continue;
    // 0090952e places buddy names in two 128px cells, advancing y by18 per pair.
    for (let index = 0; index < visible.length; index += 2) {
      rows.push({ passive: true, members: visible.slice(index, index + 2) });
    }
  }
  return rows;
}

function activateFriend(state, row) {
  if (!row.groupHeader) {
    return socialHook(state, "socialChat", {
      channel: "whisper",
      targetId: row.id,
    });
  }
  if (state.collapsedGroups.has(row.group)) {
    state.collapsedGroups.delete(row.group);
  } else state.collapsedGroups.add(row.group);
}

function drawFriendRow(state, layer, row, rect) {
  if (row.groupHeader) {
    socialText(
      layer,
      row.name,
      { x: rect.x + 5, y: rect.y + 1, width: 190 },
      { bold: true },
    );
    const count = socialText(layer, row.count, {
      x: rect.x + 196,
      y: rect.y + 1,
      width: 66,
    });
    count.style.textAlign = "right";
    return;
  }
  for (let index = 0; index < row.members.length; index++) {
    const member = row.members[index];
    socialMemberRow(state, layer, member, {
      x: rect.x + index * 128,
      y: rect.y,
      width: 128,
      height: 18,
      label: (entry) => entry.name,
      tooltip: (entry) =>
        `${memberText(entry)}\n${entry.online ? "Online" : "Offline"}\n${entry.mapName || ""}`,
      activate: (entry) => activateFriend(state, entry),
      select: (entry) => {
        state.friendLocation.textContent = `${entry.name} — ${entry.online ? entry.mapName : "Offline"}`;
      },
    });
  }
}

function drawFriends(state) {
  // backgrnd3 already contains MANAGE BUDDIES; friend0 would overwrite that heading.
  const count = socialText(
    state.layer,
    `${state.view.friends.length} / ${SOCIAL_LIMITS.friends}`,
    {
      x: 214,
      y: 60,
      width: 81,
    },
    { color: "#ffffff" },
  );
  count.style.textAlign = "right";
  socialList(
    state,
    friendRows(state),
    { x: 8, y: 113, width: 281, height: 188 },
    {
      scrollStep: 33,
      label: (row) => row.name || "",
      tooltip: () => "Double-click to expand or collapse this group.",
      activate: (row) => activateFriend(state, row),
      select: () => {
        state.friendLocation.textContent = "";
      },
      render: (layer, row, rect) => drawFriendRow(state, layer, row, rect),
      empty: "No friends registered.",
    },
  );
  const selected = selectedMember(state);
  state.friendLocation = socialText(
    state.layer,
    selected
      ? `${selected.name} — ${selected.online ? selected.mapName : "Offline"}`
      : "",
    {
      x: 10,
      y: 313,
      width: 292,
    },
  );
  friendTopButtons(state);
  friendGroupButtons(state);
  friendMemberButtons(state);
}

function friendTopButtons(state) {
  socialButton(state, {
    path: "UserList/Friend/BtAddFriend",
    x: 5,
    y: 81,
    label: "Add friend",
    action: () =>
      requestTarget(
        state,
        "friend.invite",
        "Please enter the name of your friend.",
      ),
    enabled: () => admitted(state, "friend.invite"),
  });
  socialButton(state, {
    path: "UserList/Friend/BtAddGroup",
    x: 72,
    y: 81,
    label: "Add group",
    action: () =>
      requestText(state, "friend.group", {
        text: "Enter a group name.",
        maxLength: 16,
      }),
    enabled: () => admitted(state, "friend.group"),
  });
  socialButton(state, {
    path: `UserList/Friend/${state.onlineOnly ? "BtShowAll" : "BtShowOnline"}`,
    x: 232,
    y: 81,
    label: state.onlineOnly ? "Show all friends" : "Show online friends",
    action: () => {
      state.onlineOnly = !state.onlineOnly;
      state.position = 0;
    },
  });
}

function friendGroupButtons(state) {
  socialButton(state, {
    path: "UserList/Friend/BtGroupWhisper",
    x: 8,
    y: 341,
    label: "Group whisper",
    action: () =>
      socialHook(state, "socialChat", {
        channel: "buddy",
        groupId: selectedGroup(state),
      }),
    enabled: () => Boolean(selectedGroup(state)),
  });
  socialButton(state, {
    path: "UserList/Friend/BtMod",
    x: 8,
    y: 362,
    label: "Modify friend group",
    action: () => modifyGroup(state),
    enabled: () => Boolean(state.selected),
  });
  socialButton(state, {
    path: "UserList/Friend/BtDelete",
    x: 49,
    y: 362,
    label: "Delete friend or group",
    action: () => deleteFriend(state),
    enabled: () => Boolean(state.selected),
  });
  socialButton(state, {
    path: "UserList/Friend/BtChat",
    x: 99,
    y: 341,
    label: "Buddy chat",
    action: () => socialHook(state, "socialChat", { channel: "buddy" }),
    enabled: () => state.view.friends.length > 0,
  });
}

function friendMemberButtons(state) {
  const hasMember = () => Boolean(selectedMember(state));
  socialButton(state, {
    path: "UserList/Friend/BtWhisper",
    x: 254,
    y: 341,
    label: "Whisper to friend",
    action: () =>
      socialHook(state, "socialChat", {
        channel: "whisper",
        targetId: state.selected,
      }),
    enabled: hasMember,
  });
  socialButton(state, {
    path: "UserList/Friend/BtMessage",
    x: 254,
    y: 362,
    label: "Invite friend to messenger",
    action: () =>
      state.social.execute("messenger.invite", selectedPayload(state)),
    enabled: hasMember,
  });
  socialButton(state, {
    path: "UserList/Friend/BtParty",
    x: 99,
    y: 362,
    label: "Invite friend to party",
    action: () => state.social.execute("party.invite", selectedPayload(state)),
    enabled: () => admitted(state, "party.invite") && hasMember(),
  });
  const blocked = state.view.blacklist.some(
    (member) => member.id === state.selected,
  );
  socialButton(state, {
    path: `UserList/Friend/${blocked ? "BtUnBlock" : "BtBlock"}`,
    x: 182,
    y: 362,
    label: blocked ? "Unblock friend" : "Block friend",
    action: () =>
      state.social.execute(
        blocked ? "friend.unblock" : "friend.block",
        selectedPayload(state),
      ),
    enabled: hasMember,
  });
}

function selectedGroup(state) {
  if (String(state.selected).startsWith("group:")) {
    return state.selected.slice(6);
  }
  return state.view.friends.find((friend) => friend.id === state.selected)
    ?.group;
}

async function modifyGroup(state) {
  const groupId = selectedGroup(state);
  const member = selectedMember(state);
  const name = await socialPrompt(state, {
    kind: "text",
    text: member ? `Enter the group for ${member.name}.` : "Rename this group.",
    value: groupId,
    maxLength: 16,
  });
  if (name === null) return { ok: false, code: "cancelled" };
  return state.social.execute(
    "friend.group",
    member ? { targetId: member.id, name } : { groupId, name },
  );
}

function deleteFriend(state) {
  const member = selectedMember(state);
  return member
    ? confirmSocial(
        state,
        "friend.remove",
        `Delete ${member.name} from your friends?`,
        { targetId: member.id },
      )
    : confirmSocial(state, "friend.group", "Delete this empty group?", {
        groupId: selectedGroup(state),
        remove: true,
      });
}

function drawParty(state) {
  const party = state.view.party;
  const rows = [];
  for (const online of [true, false]) {
    appendSocialSection(
      rows,
      {
        id: `party:${online}`,
        header: `UserList/Party/party${online ? 0 : 4}`,
        columns: "UserList/Party/party5",
        row: "UserList/Party/party1",
        footer: "UserList/Party/party2",
        footerHeight: 4,
      },
      party?.members.filter((member) => member.online === online) || [],
    );
  }
  socialRoster(
    state,
    rows,
    { x: 6, y: 53, width: 281, height: 278 },
    {
      columns: [
        { field: "name", x: 5, width: 106 },
        { field: "job", x: 120, width: 82 },
        { field: "level", x: 210, width: 62 },
      ],
      activate: (row) =>
        socialHook(state, "socialChat", {
          channel: "whisper",
          targetId: row.id,
        }),
    },
  );
  drawPartyMembershipButtons(state);
  drawPartySocialButtons(state, party);
  drawPartyWindowButtons(state, party);
}

function hasOtherPartyMember(state) {
  return (
    Boolean(selectedMember(state)) && state.selected !== state.view.self.id
  );
}

function drawPartyMembershipButtons(state) {
  socialButton(state, {
    path: "UserList/Party/BtCreate",
    x: 13,
    y: 355,
    label: "Create party",
    action: () => state.social.execute("party.create"),
    enabled: () => admitted(state, "party.create"),
  });
  socialButton(state, {
    path: "UserList/Party/BtInvite",
    x: 72,
    y: 365,
    label: "Invite to party",
    action: () =>
      requestTarget(
        state,
        "party.invite",
        "Enter the character name to invite.",
      ),
    enabled: () => admitted(state, "party.invite"),
  });
  socialButton(state, {
    path: "UserList/Party/BtKick",
    x: 190,
    y: 344,
    label: "Expel party member",
    action: () =>
      confirmSocial(
        state,
        "party.expel",
        `Expel ${selectedMember(state)?.name}?`,
        selectedPayload(state),
      ),
    enabled: () => admitted(state, "party.expel") && hasOtherPartyMember(state),
  });
  socialButton(state, {
    path: "UserList/Party/BtWithdraw",
    x: 190,
    y: 364,
    label: "Leave party",
    action: () => confirmSocial(state, "party.leave", "Leave this party?"),
    enabled: () => admitted(state, "party.leave"),
  });
}

function drawPartySocialButtons(state, party) {
  socialButton(state, {
    path: "UserList/Party/BtWhisper",
    x: 249,
    y: 345,
    label: "Whisper to party member",
    action: () =>
      socialHook(state, "socialChat", {
        channel: "whisper",
        targetId: state.selected,
      }),
    enabled: () => hasOtherPartyMember(state),
  });
  socialButton(state, {
    path: "UserList/Party/BtChat",
    x: 249,
    y: 365,
    label: "Party chat",
    action: () => socialHook(state, "socialChat", { channel: "party" }),
    enabled: Boolean(party),
  });
  socialButton(state, {
    path: "UserList/Party/BtChangeBoss",
    x: 131,
    y: 365,
    label: "Change party leader",
    action: () =>
      confirmSocial(
        state,
        "party.leader",
        `Do you wish to pass the leader position to ${selectedMember(state)?.name}?`,
        selectedPayload(state),
      ),
    enabled: () =>
      admitted(state, "party.leader") && hasOtherPartyMember(state),
  });
}

function drawPartyWindowButtons(state, party) {
  const showHp = state.panel.owner.windows.has("PartyHP");
  const hp = socialButton(state, {
    path: "UserList/Party/BtHP",
    x: 131,
    y: 345,
    label: showHp ? "Hide party HP" : "Show party HP",
    action: () => togglePartyHP(state),
    enabled: Boolean(party),
  });
  hp.element.setAttribute("aria-pressed", String(showHp));
  socialButton(state, {
    path: "UserList/Party/BtSearch",
    x: 72,
    y: 345,
    label: "Party search",
    action: () => state.panel.owner.open("PartySearch"),
  });
}

async function togglePartyHP(state) {
  const hook = state.panel.owner.hooks.socialPartyHp;
  if (typeof hook !== "function") {
    return {
      ok: false,
      code: "unavailable",
      reason: "Party health is not connected.",
    };
  }
  // Native0090e51c consults the actual PartyHP singleton. Never retain an optimistic toggle bit.
  const enabled = !state.panel.owner.windows.has("PartyHP");
  const outcome = await hook(enabled);
  if (!outcome || typeof outcome.ok !== "boolean") {
    return {
      ok: false,
      code: "unavailable",
      reason: "Party health did not return an opening outcome.",
    };
  }
  return outcome;
}

function drawBlacklist(state) {
  const branch = "UserList/BlackList/blacklist";
  const rows = [
    { passive: true, heading: true, height: 27, art: `${branch}0` },
  ];
  for (let index = 0; index < state.view.blacklist.length; index += 2) {
    rows.push({
      passive: true,
      height: 18,
      art: `${branch}1`,
      members: state.view.blacklist.slice(index, index + 2),
    });
  }
  if (!state.view.blacklist.length) {
    rows.push({ passive: true, height: 18, art: `${branch}1`, members: [] });
  }
  rows.push({ passive: true, footer: true, height: 6, art: `${branch}2` });
  socialList(
    state,
    rows,
    { x: 6, y: 53, width: 281, height: 278 },
    {
      rowHeight: (row) => row.height,
      scrollStep: 33,
      background: (row) => row.art,
      label: () => "",
      render: (layer, row, rect) => drawBlacklistRow(state, layer, row, rect),
    },
  );
  socialButton(state, {
    path: "UserList/BlackList/BtAdd",
    x: 60,
    y: 355,
    label: "Add to blacklist",
    enabled: () => admitted(state, "friend.block"),
    action: () =>
      requestTarget(
        state,
        "friend.block",
        "Enter the character name to block.",
      ),
  });
  socialButton(state, {
    path: "UserList/BlackList/BtDelete",
    x: 180,
    y: 355,
    label: "Remove from blacklist",
    enabled: () => admitted(state, "friend.unblock", true),
    action: () =>
      state.social.execute("friend.unblock", selectedPayload(state)),
  });
}

function drawBlacklistRow(state, layer, row, rect) {
  if (row.footer) return;
  if (row.heading) {
    const count = socialText(
      layer,
      state.view.blacklist.length,
      {
        x: rect.x + 211,
        y: rect.y + 8,
        width: 50,
      },
      { color: "#ffffff" },
    );
    count.style.textAlign = "right";
    return;
  }
  if (!row.members.length) {
    socialText(
      layer,
      "No blocked characters.",
      {
        x: rect.x + 5,
        y: rect.y + 2,
        width: rect.width - 10,
      },
      { color: "#888888" },
    );
  }
  for (let index = 0; index < row.members.length; index++) {
    socialMemberRow(state, layer, row.members[index], {
      x: rect.x + index * 128,
      y: rect.y,
      width: 128,
      height: 18,
      label: (member) => member.name,
      render: (target, member, cell) =>
        socialColumns(target, member, cell, [
          { field: "name", x: 5, width: 120 },
        ]),
    });
  }
}
