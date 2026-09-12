import {
  replaceSocialLayer,
  socialButton,
  socialList,
  socialText,
  admitted,
  requestTarget,
  requestText,
  socialPrompt,
  confirmSocial,
  socialHook,
  runSocialAction,
  socialRoster,
  appendSocialSection,
} from "./ui-social-controls.js";
import { NativeScrollbar } from "./ui-scrollbar.js";

/** 00919b73 creates the guild and union controls at the same native coordinates. */
export function drawGuild(state, alliance) {
  const group = alliance ? state.view.alliance : state.view.guild;
  const domain = alliance ? "alliance" : "guild";
  const branch = alliance ? "UserList/GuildUnion" : "UserList/Guild/GuildInfo";
  drawGuildSummary(state, group, alliance, branch);
  drawGuildMembershipButtons(state, group, domain, branch);
  drawGuildRankButtons(state, group, domain, branch);
  drawGuildChatButtons(state, group, domain, branch);
  drawGuildNavigationButtons(state, group, alliance, branch);
  if (group) {
    socialButton(state, {
      path: `${branch}/BtChange`,
      x: 9,
      y: 363,
      label: "Change leader",
      action: () =>
        confirmSocial(
          state,
          `${domain}.leader`,
          "Transfer the leader position to this member?",
          { targetId: state.selected },
        ),
      enabled: () =>
        admitted(state, `${domain}.leader`) &&
        hasOtherGuildMember(state, group),
    });
  }
}

function drawGuildSummary(state, group, alliance, branch) {
  drawGuildName(state, group, alliance);
  const notice = socialText(state.layer, group?.notice || "", {
    x: 18,
    y: 82,
    width: 264,
    height: 16,
  });
  notice.title = group?.notice || "";
  const rows = alliance ? unionRows(group) : guildRows(group, branch);
  socialRoster(
    state,
    rows,
    { x: 6, y: 113, width: 281, height: 192 },
    {
      columns: [
        { field: "name", x: 5, width: 88 },
        { field: "job", x: 102, width: 60 },
        { field: "level", x: 170, width: 31 },
        { field: "rankTitle", x: 210, width: 67 },
      ],
      activate: (row) => socialHook(state, "socialOpenUserInfo", row.id),
    },
  );
}

function guildRows(group, branch) {
  const rows = [];
  for (const online of [true, false]) {
    appendSocialSection(
      rows,
      {
        id: `guild:${online}`,
        header: `${branch}/guildinfo${online ? 0 : 1}`,
        columns: `${branch}/guildinfo2`,
        row: `${branch}/guildinfo3`,
        footer: `${branch}/guildinfo4`,
        footerHeight: 1,
      },
      group?.members.filter((member) => member.online === online) || [],
    );
  }
  return rows;
}

/** 0090f232..0090f3ce centers the name plus a26px emblem advance in306px. */
function drawGuildName(state, group, alliance) {
  const name = group?.name || (alliance ? "No Guild Alliance" : "No guild");
  const node = socialText(
    state.layer,
    name,
    { x: 3, y: 57, width: 306 },
    { bold: true },
  );
  if (alliance || !group) {
    node.style.textAlign = "center";
    return;
  }
  node.style.width = "max-content";
  const x = Math.trunc((306 - node.offsetWidth - 26) / 2);
  node.style.left = `${x + 26}px`;
  if (!group.emblem.logo) {
    state.layer.image("UserList/Guild/GuildInfo/guildmark", x, 54);
    return;
  }
  for (const background of [true, false]) {
    const options = emblemOptions(state, background);
    const id = background ? group.emblem.background : group.emblem.logo;
    const color = background
      ? group.emblem.backgroundColor
      : group.emblem.logoColor;
    const mark = options.find(
      (entry) => entry.id === id && entry.color === color,
    );
    if (mark) state.layer.image(mark.path, x, 55);
  }
}

function hasOtherGuildMember(state, group) {
  return Boolean(
    group?.members.find(
      (member) =>
        member.id === state.selected && member.id !== state.view.self.id,
    ),
  );
}

function drawGuildMembershipButtons(state, group, domain, branch) {
  socialButton(state, {
    path: `${branch}/BtInvite`,
    x: 9,
    y: 316,
    label: "Invite",
    action: () =>
      requestTarget(
        state,
        `${domain}.invite`,
        domain === "alliance"
          ? "Enter the name of the guild leader to invite."
          : "Enter the character name to invite.",
      ),
    enabled: () => admitted(state, `${domain}.invite`),
  });
  socialButton(state, {
    path: `${branch}/BtWithdraw`,
    x: 80,
    y: 316,
    label: "Leave",
    action: () =>
      confirmSocial(
        state,
        `${domain}.leave`,
        domain === "alliance"
          ? "Are you sure you want to leave the Union?"
          : "Leave your guild?",
      ),
    enabled: () => admitted(state, `${domain}.leave`),
  });
  socialButton(state, {
    path: `${branch}/BtKick`,
    x: 159,
    y: 336,
    label: "Expel",
    action: () =>
      confirmSocial(state, `${domain}.expel`, "Expel the selected member?", {
        targetId: state.selected,
      }),
    enabled: () =>
      admitted(state, `${domain}.expel`) && hasOtherGuildMember(state, group),
  });
}

function drawGuildRankButtons(state, group, domain, branch) {
  socialButton(state, {
    path: `${branch}/BtUp`,
    x: 9,
    y: 336,
    label: "Promote",
    action: () => changeRank(state, domain, -1),
    enabled: () =>
      admitted(state, `${domain}.rank`) && hasOtherGuildMember(state, group),
  });
  socialButton(state, {
    path: `${branch}/BtDown`,
    x: 80,
    y: 336,
    label: "Demote",
    action: () => changeRank(state, domain, 1),
    enabled: () =>
      admitted(state, `${domain}.rank`) && hasOtherGuildMember(state, group),
  });
  socialButton(state, {
    path: `${branch}/BtWhere`,
    x: 159,
    y: 316,
    label: "Find member",
    action: () => showWhere(state),
    enabled: () => hasOtherGuildMember(state, group),
  });
}

function drawGuildChatButtons(state, group, domain, branch) {
  socialButton(state, {
    path: `${branch}/BtChat`,
    x: 238,
    y: 336,
    label: domain === "alliance" ? "Guild Union chat" : "Guild chat",
    action: () => socialHook(state, "socialChat", { channel: domain }),
    enabled: Boolean(group),
  });
  socialButton(state, {
    path: `${branch}/BtWhisper`,
    x: 238,
    y: 316,
    label: "Whisper",
    action: () =>
      socialHook(state, "socialChat", {
        channel: "whisper",
        targetId: state.selected,
      }),
    enabled: () => hasOtherGuildMember(state, group),
  });
  socialButton(state, {
    path: `${branch}/Btnotice`,
    x: domain === "alliance" ? 288 : 287,
    y: 80,
    label: "Edit notice",
    action: () =>
      requestText(state, `${domain}.notice`, {
        text: "Enter the notice.",
        value: group?.notice || "",
        maxLength: domain === "alliance" ? 20 : 100,
      }),
    enabled: () => admitted(state, `${domain}.notice`),
  });
}

function drawGuildNavigationButtons(state, group, alliance, branch) {
  socialButton(state, {
    path: `${branch}/BtPartyInvite`,
    x: 159,
    y: 363,
    label: "Invite to party",
    action: () =>
      state.social.execute("party.invite", { targetId: state.selected }),
    enabled: () =>
      admitted(state, "party.invite") && hasOtherGuildMember(state, group),
  });
  socialButton(state, {
    path: `${branch}/BtInfo`,
    x: 238,
    y: 363,
    label: "Guild information",
    action: () => {
      state.mode = "guild-edit";
    },
    enabled: Boolean(group),
  });
  if (!alliance) {
    socialButton(state, {
      path: `${branch}/BtGuildBBS`,
      x: 80,
      y: 363,
      label: "Guild bulletin board",
      action: () => {
        state.mode = "board";
        state.selected = null;
        state.position = 0;
      },
      enabled: Boolean(group && !group.forming),
    });
  }
}

function unionRows(union) {
  const rows = [];
  const branch = "UserList/GuildUnion";
  if (!union) {
    appendSocialSection(
      rows,
      {
        id: "alliance:empty",
        header: `${branch}/guildinfo0`,
        title: "Guild Alliance",
        columns: `${branch}/guildinfo2`,
        row: `${branch}/guildinfo3`,
        footer: `${branch}/guildinfo4`,
        footerHeight: 1,
      },
      [],
    );
    return rows;
  }
  const members = new Map(union.members.map((member) => [member.id, member]));
  for (const guild of union.guilds) {
    const roster = [];
    for (const member of guild.members) {
      const unionMember = members.get(member.id);
      if (unionMember) roster.push(unionMember);
    }
    roster.sort((left, right) => Number(right.online) - Number(left.online));
    appendSocialSection(
      rows,
      {
        id: `guild:${guild.id}`,
        title: guild.name,
        header: `${branch}/guildinfo0`,
        columns: `${branch}/guildinfo2`,
        row: `${branch}/guildinfo3`,
        footer: `${branch}/guildinfo4`,
        footerHeight: 1,
      },
      roster,
    );
  }
  return rows;
}

function showWhere(state) {
  const member = state.view.participants.find(
    (entry) => entry.id === state.selected,
  );
  if (member) state.panel.owner.notice(`${member.name}: ${member.mapName}`);
}

function changeRank(state, domain, delta) {
  const group = domain === "guild" ? state.view.guild : state.view.alliance;
  const member = group?.members.find((entry) => entry.id === state.selected);
  if (!member) {
    return {
      ok: false,
      code: "member-not-selected",
      reason: "Select a member first.",
    };
  }
  return state.social.execute(`${domain}.rank`, {
    targetId: member.id,
    rank: member.rank + delta,
  });
}

function sizePanel(state, width, height) {
  state.panel.width = width;
  state.panel.height = height;
  state.panel.element.style.width = `${width}px`;
  state.panel.element.style.height = `${height}px`;
  if (state.panel.dragStrip) {
    state.panel.dragStrip.style.width = `${width - 24}px`;
  }
  state.panel.closeControl?.position(width - 17, 6);
}

export function drawGuildEditor(state) {
  const domain = state.panel.localTab === 3 ? "alliance" : "guild";
  const guild = state.view[domain];
  if (state.mode === "emblem") return drawEmblemEditor(state);
  sizePanel(state, 312, 389);
  replaceSocialLayer(state, "UserList/backgrnd2");
  state.layer.image("UserList/Guild/backgrnd", 40, 42);
  socialText(
    state.layer,
    guild.name,
    { x: 52, y: 48, width: 208 },
    { bold: true },
  );
  drawGuildRanks(state, guild, domain);
  socialButton(state, {
    path: "UserList/Guild/GuildGrade/BtModf",
    x: 51,
    y: 247,
    label: "Edit rank titles",
    enabled: () => admitted(state, `${domain}.rank`),
    action: () => editRankTitle(state, 0),
  });
  if (domain === "guild") {
    socialButton(state, {
      path: "UserList/Guild/GuildInfo/BtInfo",
      x: 146,
      y: 247,
      label: "Edit guild emblem",
      enabled: () => admitted(state, "guild.emblem"),
      action: () => {
        state.emblemDraft = { ...guild.emblem };
        state.mode = "emblem";
      },
    });
    socialButton(state, {
      path: "UserList/Guild/GuildInfo/BtWithdraw",
      x: 51,
      y: 276,
      label: "Disband guild",
      enabled: () => admitted(state, "guild.disband"),
      action: () =>
        confirmSocial(
          state,
          "guild.disband",
          "Disband this guild? All memberships will be removed.",
        ),
    });
  }
  socialButton(state, {
    path: "UserList/Guild/GuildGrade/BtSave",
    x: 116,
    y: 353,
    label: "Return to guild",
    action: () => {
      state.mode = null;
    },
  });
  state.restoreFocus();
}

/**
 * UI.wz GuildGrade: guildgrade0 is the 27px heading, guildgrade1 the 18px
 * column header, and guildgrade2 the complete five-row, 90px blank table.
 * 00916908–00916aaf composes them with a 10px heading/header gap; 00916b6f,
 * 00916bfe and 00916d87 place rank/title at table x+20/x+60, y+4, step 18.
 * Keep this table anchored to the existing composite editor's header at y112.
 */
function drawGuildRanks(state, guild, domain) {
  state.layer.image("UserList/Guild/GuildGrade/guildgrade0", 46, 75);
  state.layer.image("UserList/Guild/GuildGrade/guildgrade1", 46, 112);
  state.layer.image("UserList/Guild/GuildGrade/guildgrade2", 46, 130);
  for (let rank = 0; rank < 5; rank++) {
    const y = 130 + rank * 18;
    socialText(
      state.layer,
      rank + 1,
      { x: 66, y: y + 4, width: 26, height: 14 },
      { lineHeight: 14 },
    );
    const text = guild.ranks?.[rank] || `Rank ${rank + 1}`;
    socialText(
      state.layer,
      text,
      { x: 106, y: y + 4, width: 84, height: 14 },
      { lineHeight: 14 },
    );
    state.layer.hit(
      `Edit rank ${rank + 1}`,
      { x: 46, y, width: 221, height: 18 },
      {
        click: () => {
          if (!admitted(state, `${domain}.rank`)) return;
          runSocialAction(state, () => editRankTitle(state, rank));
        },
      },
    );
  }
}

async function editRankTitle(state, rank) {
  const domain = state.panel.localTab === 3 ? "alliance" : "guild";
  const guild = state.view[domain];
  const name = await socialPrompt(state, {
    kind: "text",
    text: `Enter the title for rank ${rank + 1}.`,
    value: guild.ranks[rank],
    maxLength: domain === "alliance" ? 11 : 45,
  });
  if (name === null) return { ok: false, code: "cancelled" };
  const ranks = [...guild.ranks];
  ranks[rank] = name;
  return state.social.execute(`${domain}.rank`, { ranks });
}

/** Emblem IDs and colors are enumerated from actual GuildMark canvases, never synthesized. */
function emblemOptions(state, background) {
  const options = [];
  for (const path of Object.keys(state.panel.assets)) {
    const match = background
      ? path.match(/^GuildMark\/BackGround\/(\d+)\/(\d+)$/)
      : path.match(/^GuildMark\/Mark\/[^/]+\/(\d+)\/(\d+)$/);
    if (match) {
      options.push({ path, id: Number(match[1]), color: Number(match[2]) });
    }
  }
  if (!options.length || options.length > 4096) {
    throw new Error(
      "Original GuildMark emblem/color canvases are missing or exceed the source budget",
    );
  }
  return options;
}

function drawEmblemEditor(state) {
  sizePanel(state, 312, 389);
  replaceSocialLayer(state, "UserList/backgrnd2");
  state.layer.image("UserList/Guild/MakeMark/backgrnd/14", 30, 25);
  const background = emblemOptions(state, true);
  const logos = emblemOptions(state, false);
  const draft = state.emblemDraft;
  const back =
    background.find(
      (entry) =>
        entry.id === draft.background && entry.color === draft.backgroundColor,
    ) || background[0];
  const logo =
    logos.find(
      (entry) => entry.id === draft.logo && entry.color === draft.logoColor,
    ) || logos[0];
  state.layer.image(back.path, 148, 78);
  state.layer.image(logo.path, 148, 78);
  drawEmblemChoices(state, draft, {
    rows: background,
    current: back,
    background: true,
    y: 155,
  });
  drawEmblemChoices(state, draft, {
    rows: logos,
    current: logo,
    background: false,
    y: 235,
  });
  drawEmblemSaveButtons(state, back, logo);
}

function drawEmblemChoices(state, draft, choice) {
  const { current, background, y } = choice;
  socialButton(state, {
    path: "UserList/Guild/MakeMark/BtLeft",
    x: 56,
    y,
    label: background
      ? "Previous background and color"
      : "Previous emblem and color",
    action: () => cycleEmblem(draft, choice, -1),
  });
  socialButton(state, {
    path: "UserList/Guild/MakeMark/BtRight",
    x: 216,
    y,
    label: background ? "Next background and color" : "Next emblem and color",
    action: () => cycleEmblem(draft, choice, 1),
  });
  state.layer.image(current.path, 149, y);
}

function cycleEmblem(draft, choice, delta) {
  const { rows, current, background } = choice;
  const next =
    rows[(rows.indexOf(current) + rows.length + delta) % rows.length];
  if (background) {
    draft.background = next.id;
    draft.backgroundColor = next.color;
  } else {
    draft.logo = next.id;
    draft.logoColor = next.color;
  }
}

function drawEmblemSaveButtons(state, back, logo) {
  socialButton(state, {
    path: "UserList/Guild/MakeMark/BtAgree",
    x: 96,
    y: 331,
    label: "Save emblem",
    enabled: () => admitted(state, "guild.emblem"),
    action: () =>
      confirmSocial(state, "guild.emblem", "Save this guild emblem?", {
        emblem: {
          background: back.id,
          backgroundColor: back.color,
          logo: logo.id,
          logoColor: logo.color,
        },
      }),
  });
  socialButton(state, {
    path: "UserList/Guild/MakeMark/BtDisagree",
    x: 176,
    y: 331,
    label: "Cancel emblem",
    action: () => {
      state.mode = "guild-edit";
      state.emblemDraft = null;
    },
  });
}

export function drawGuildBoard(state) {
  sizePanel(state, 734, 526);
  replaceSocialLayer(state, "GuildBBS/backgrnd");
  const threads = state.view.guild.threads || [];
  socialList(
    state,
    threads,
    { x: 25, y: 99, width: 330, height: 340 },
    {
      rowHeight: 34,
      label: (thread) =>
        `${thread.notice ? "Notice: " : ""}${thread.title}\n${authorName(state, thread.authorId)}`,
      wrap: true,
      tooltip: (thread) => thread.text,
      empty: "There are no guild posts.",
      select: (thread) => {
        state.threadId = thread.id;
        state.refresh();
      },
    },
  );
  const thread = threads.find(
    (entry) => entry.id === (state.threadId || state.selected),
  );
  if (thread) drawThread(state, thread);
  boardButtons(state, thread);
  state.restoreFocus();
}

function boardButtons(state, thread) {
  socialButton(state, {
    path: "GuildBBS/BtNotice",
    x: 24,
    y: 477,
    label: "Write guild notice",
    action: () => writeThread(state, null, true),
    enabled: () => admitted(state, "guild.notice"),
  });
  socialButton(state, {
    path: "GuildBBS/BtWrite",
    x: 91,
    y: 477,
    label: "Write guild post",
    action: () => writeThread(state),
    enabled: () => admitted(state, "guild.board.write"),
  });
  socialButton(state, {
    path: "GuildBBS/BtRetouch",
    x: 158,
    y: 477,
    label: "Edit guild post",
    action: () => writeThread(state, thread),
    enabled: () => Boolean(thread && mayEditPost(state, thread.authorId)),
  });
  socialButton(state, {
    path: "GuildBBS/BtDelete",
    x: 225,
    y: 477,
    label: "Delete guild post",
    action: () =>
      confirmSocial(state, "guild.board.delete", "Delete this guild post?", {
        threadId: thread.id,
      }),
    enabled: () => Boolean(thread && mayEditPost(state, thread.authorId)),
  });
  socialButton(state, {
    path: "GuildBBS/BtQuit",
    x: 667,
    y: 498,
    label: "Close guild board",
    action: () => {
      state.mode = null;
      state.selected = null;
      state.position = 0;
    },
  });
}

function drawThread(state, thread) {
  socialText(
    state.layer,
    thread.title,
    { x: 388, y: 85, width: 300 },
    { bold: true },
  );
  drawPostText(state, `${authorName(state, thread.authorId)}\n${thread.text}`);
  drawComments(state, thread);
  socialButton(state, {
    path: "GuildBBS/BtReply",
    x: 693,
    y: 449,
    label: "Reply to guild post",
    enabled: () => admitted(state, "guild.board.comment"),
    action: () =>
      requestText(
        state,
        "guild.board.comment",
        { text: "Enter your reply.", maxLength: 25 },
        { threadId: thread.id },
      ),
  });
}

function mayEditPost(state, authorId) {
  return (
    authorId === state.view.self.id ||
    state.view.guild.members.find((member) => member.id === state.view.self.id)
      ?.rank <= 2
  );
}

function drawPostText(state, text) {
  const layer = state.layer.layer("Guild post text");
  layer.listen(layer.element, "wheel", (event) => event.stopPropagation());
  const content = layer.contentArea(388, 112, 297, 198);
  content.style.cssText +=
    ";overflow:hidden;white-space:pre-wrap;font:11px Tahoma,sans-serif;line-height:16px";
  content.textContent = text;
  const scrollbar = new NativeScrollbar(
    layer,
    { x: 704, y: 112, extent: 198 },
    (position) => {
      content.scrollTop = position * 16;
    },
  );
  scrollbar.setRange(
    Math.max(
      1,
      Math.ceil((content.scrollHeight - content.clientHeight) / 16) + 1,
    ),
  );
}

function drawComments(state, thread) {
  const comments = thread.comments || [];
  if (comments.length > 64) throw new Error("Guild comment budget exceeded");
  const layer = state.layer.layer("Guild replies");
  layer.listen(layer.element, "wheel", (event) => event.stopPropagation());
  let body;
  const paint = (position) => {
    body?.destroy();
    body = layer.layer("Visible guild replies");
    for (
      let index = position;
      index < Math.min(comments.length, position + 6);
      index++
    ) {
      const comment = comments[index],
        y = 319 + (index - position) * 20;
      socialText(
        body,
        `${authorName(state, comment.authorId)}: ${comment.text}`,
        { x: 388, y, width: 283 },
      );
      body.button("GuildBBS/BtReplyDelete", 678, y, {
        label: `Delete reply by ${authorName(state, comment.authorId)}`,
        disabled: !mayEditPost(state, comment.authorId),
        action: () =>
          runSocialAction(state, () =>
            confirmSocial(
              state,
              "guild.board.comment.remove",
              "Delete this reply?",
              { threadId: thread.id, commentId: comment.id },
            ),
          ),
      });
    }
    state.panel.renderArtwork();
  };
  const scrollbar = new NativeScrollbar(
    layer,
    { x: 704, y: 319, extent: 123 },
    paint,
  );
  scrollbar.setRange(Math.max(1, comments.length - 5));
  paint(0);
}

async function writeThread(state, thread = null, notice = false) {
  const name = await socialPrompt(state, {
    kind: "text",
    text: "Enter the post title.",
    value: thread?.title || "",
    maxLength: 25,
  });
  if (name === null) return { ok: false, code: "cancelled" };
  const text = await socialPrompt(state, {
    kind: "text",
    text: "Enter the post contents.",
    value: thread?.text || "",
    maxLength: 600,
  });
  if (text === null) return { ok: false, code: "cancelled" };
  if (thread) {
    return state.social.execute("guild.board.edit", {
      threadId: thread.id,
      name,
      text,
      notice: thread.notice || notice,
    });
  }
  return state.social.execute("guild.board.write", {
    threadId: undefined,
    name,
    text,
    notice,
  });
}

function authorName(state, id) {
  return (
    state.view.participants.find((member) => member.id === id)?.name ||
    "Unloaded local character"
  );
}
