import { familyTreeView } from "../social/local-social-view.js";
import { JOB_LABELS } from "./ui-job-labels.js";
import {
  socialView,
  replaceSocialLayer,
  socialText,
  socialButton,
  requestTarget,
  confirmSocial,
  admitted,
  socialPrompt,
  runSocialAction,
} from "./ui-social-controls.js";

// Maplestory_UNPACKED.exe00809ab9: type0x1c, (111,107),578×386, depth10.
// 00be2778..00be27cc /0080acd3: eleven133×34 plate hit rectangles.
const PLATES = Object.freeze([
  [222, 40],
  [222, 94],
  [222, 146],
  [222, 198],
  [365, 198],
  [80, 250],
  [365, 250],
  [13, 302],
  [148, 302],
  [297, 302],
  [432, 302],
]);
const MUTABLE_SLOTS = Object.freeze([2, 5, 6]);

/** Native FamilyTree is a separate owner; this observer never becomes the viewed actor. */
export function layoutFamilyTree(panel, social) {
  const state = socialView(panel, social, drawFamilyTree);
  state.rootId = panel.owner.hooks.familyTreeTarget?.() ?? state.view.self.id;
  panel.setFamilyRoot = (id) => {
    if (panel.disposed) {
      return {
        ok: false,
        code: "window-closed",
        reason: "The family tree is closed.",
      };
    }
    const view = familyTreeView(social, id);
    if (!view.ok) return view;
    state.rootId = id;
    state.selected = null;
    state.refresh();
    return { ok: true };
  };
  panel.cleanups.push(() => {
    delete panel.setFamilyRoot;
    delete panel.localRefresh;
  });
  state.refresh();
}

/** 0080a5f7: leader, grand-senior, senior, root, sibling, two juniors and four grand-juniors. */
function treeSlots(tree) {
  const byId = new Map(tree.members.map((member) => [member.id, member]));
  const children = new Map();
  for (const member of tree.members) {
    if (!children.has(member.parentId)) children.set(member.parentId, []);
    children.get(member.parentId).push(member);
  }
  const parent = byId.get(tree.root.parentId),
    juniors = children.get(tree.root.id) || [];
  const sibling =
    parent &&
    children.get(parent.id)?.find((member) => member.id !== tree.root.id);
  const left = children.get(juniors[0]?.id) || [],
    right = children.get(juniors[1]?.id) || [];
  return {
    byId,
    children,
    members: [
      byId.get(tree.leaderId),
      byId.get(parent?.parentId),
      parent,
      tree.root,
      sibling,
      juniors[0],
      juniors[1],
      left[0],
      left[1],
      right[0],
      right[1],
    ],
  };
}

function drawFamilyTree(state) {
  replaceSocialLayer(state, "FamilyTree/backgrnd");
  state.tree = familyTreeView(state.social, state.rootId);
  if (!state.tree.ok) {
    socialText(
      state.layer,
      state.tree.reason,
      { x: 130, y: 80, width: 410, height: 45 },
      { color: "#ffffff", wrap: true },
    );
    drawTreeControls(state);
    state.restoreFocus();
    return;
  }
  state.slots = treeSlots(state.tree);
  if (!state.slots.members.some((member) => member?.id === state.selected)) {
    state.selected = null;
  }
  const leader = state.slots.members[0];
  treeText(
    state,
    leader ? `${leader.name}'s Family` : `${state.tree.root.name}'s Family`,
    { x: 205, y: 10, width: 167 },
    "#ffffff",
  );
  treeText(state, state.tree.members.length || 1, { x: 29, y: 41, width: 72 });
  for (let index = 0; index < PLATES.length; index++) drawPlate(state, index);
  state.selectionImage = state.layer.image("FamilyTree/selected", 0, 0, true);
  updateSelection(state);
  drawHiddenCounts(state);
  drawTreeControls(state);
  state.restoreFocus();
}

function treeText(state, text, rect, color = "#000000") {
  const node = socialText(state.layer, text, rect, { color, lineHeight: 13 });
  node.style.textAlign = "center";
}

function drawPlate(state, index) {
  const member = state.slots.members[index],
    [x, y] = PLATES[index];
  if (!member) return drawEmptyPlate(state, index);
  drawPlateDetails(state, member, index);
  const tooltip = `${member.name}\nLv.${member.level} ${JOB_LABELS[member.job] || "Unknown job"}\nReputation: ${member.reputation ?? 0}\nToday's reputation: ${member.todayReputation ?? 0}\nTotal reputation: ${member.totalReputation ?? 0}\n${member.mapName}\nRight-click or Shift+Enter: inspect this saved member's pedigree.`;
  state.layer.hit(
    `Family member ${member.name}`,
    { x, y, width: 133, height: 34 },
    {
      click: () => choosePlate(state, member, index),
      dblclick: () => {
        if (ownsRoot(state) && MUTABLE_SLOTS.includes(index)) {
          runSocialAction(state, () => severRelationship(state, member.id));
        }
      },
      contextmenu: (event) => {
        event.preventDefault();
        runSocialAction(state, () => navigateTree(state, member.id));
      },
      keydown: (event) => {
        if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          runSocialAction(state, () => navigateTree(state, member.id));
        }
      },
    },
    { tooltip },
  );
}

function drawEmptyPlate(state, index) {
  const [x, y] = PLATES[index];
  const junior = index === 5 || index === 6;
  if (index !== 3) {
    treeText(
      state,
      junior ? "Add Junior" : "None",
      { x, y: y + 11, width: 133 },
      "#aaaaaa",
    );
  }
  if (junior && canInvite(state)) {
    state.layer.hit(
      "Add junior",
      { x, y, width: 133, height: 34 },
      { click: () => runSocialAction(state, () => inviteJunior(state)) },
      { tooltip: "Add a junior to your own family." },
    );
  }
}

function drawPlateDetails(state, member, index) {
  const [x, y] = PLATES[index];
  // 0080aed4: plate variant is online, not whether this identity is the current player.
  if (index !== 3) {
    state.layer.image(
      `FamilyTree/${index === 0 ? "PlateLeader" : "PlateOthers"}/${Number(member.online)}`,
      x,
      y,
    );
  }
  const parent = state.slots.byId.get(member.parentId);
  const warning =
    ownsRoot(state) && index >= 5 && parent && member.level > parent.level;
  treeText(
    state,
    member.name,
    { x, y: y + (index === 0 ? 6 : 5), width: 133 },
    warning ? "#ff0000" : "#000000",
  );
  treeText(
    state,
    `Lv.${member.level} ${JOB_LABELS[member.job] || "Unknown job"}`,
    { x: x - 10, y: y + (index === 0 ? 21 : 20), width: 153 },
    "#aaaaaa",
  );
}

/** Read-only local navigation extends the source plate surface, never its mutation authority. */
function choosePlate(state, member, index) {
  if (state.pending || state.view.busy) return;
  if (ownsRoot(state) && MUTABLE_SLOTS.includes(index)) {
    state.selected = member.id;
    updateSelection(state);
    state.panel.renderArtwork();
  } else if (member.id !== state.rootId) {
    runSocialAction(state, () => navigateTree(state, member.id));
  }
}

function updateSelection(state) {
  const index = MUTABLE_SLOTS.find(
    (slot) => state.slots.members[slot]?.id === state.selected,
  );
  state.selectionImage.container.visible =
    ownsRoot(state) && index !== undefined;
  if (index !== undefined) state.selectionImage.setPosition(...PLATES[index]);
}

function navigateTree(state, id) {
  const current = familyTreeView(state.social, state.rootId);
  if (!current.ok) return current;
  if (!current.members.some((member) => member.id === id)) {
    return {
      ok: false,
      code: "family-member-missing",
      reason: "That character is no longer in the viewed saved genealogy.",
    };
  }
  return state.panel.setFamilyRoot(id);
}

function ownsRoot(state) {
  return state.tree.ok && state.rootId === state.view.self.id;
}

function canInvite(state) {
  return (
    ownsRoot(state) &&
    admitted(state, "family.invite") &&
    (state.slots.children.get(state.rootId)?.length || 0) < 2
  );
}

function inviteJunior(state) {
  if (!canInvite(state)) {
    return {
      ok: false,
      code: "family-view-only",
      reason: "Only your own pedigree can add juniors.",
    };
  }
  return requestTarget(
    state,
    "family.invite",
    "Enter the name of the character you wish to add as Junior. You must be in the same map.",
  );
}

function drawTreeControls(state) {
  // 00809ccc constructs only these two controls; arrows/connectors belong to backgrnd.
  socialButton(state, {
    path: "FamilyTree/BtJuniorEntry",
    x: 21,
    y: 57,
    label: "Add junior",
    enabled: () => canInvite(state),
    action: () => inviteJunior(state),
  });
  socialButton(state, {
    path: "FamilyTree/BtBye",
    x: 71,
    y: 57,
    label: "Sever family relationship",
    enabled: () => ownsRoot(state) && admitted(state, "family.sever"),
    action: () => severRelationship(state, state.selected),
  });
}

async function severRelationship(state, selectedId) {
  if (!ownsRoot(state) || !admitted(state, "family.sever")) {
    return {
      ok: false,
      code: "family-view-only",
      reason:
        "Only your own senior or direct junior relationship can be severed.",
    };
  }
  let member = state.tree.members.find((entry) => entry.id === selectedId);
  if (!member) {
    const name = await socialPrompt(state, {
      kind: "text",
      text: "Enter the name of your senior or direct junior.",
      maxLength: 12,
    });
    if (name === null) return { ok: false, code: "cancelled" };
    member = state.tree.members.find(
      (entry) => entry.name.toLowerCase() === name.trim().toLowerCase(),
    );
  }
  if (!ownsRoot(state) || !member) {
    return {
      ok: false,
      code: "family-link",
      reason: "Choose your own senior or direct junior.",
    };
  }
  const root = state.tree.root;
  const targetId =
    root.parentId === member.id
      ? root.id
      : member.parentId === root.id
        ? member.id
        : null;
  if (!targetId) {
    return {
      ok: false,
      code: "family-link",
      reason:
        "Only your own senior or direct junior relationship can be severed.",
    };
  }
  return confirmSocial(
    state,
    "family.sever",
    `Sever your family relationship with ${member.name}? The local family authority applies its meso and reputation cost.`,
    { targetId },
  );
}

/** Bounded saved-tree counts; no imaginary continuation nodes are generated. */
function descendantCount(state, id) {
  const queue = [id],
    seen = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    for (const member of state.slots.children.get(queue[index]) || []) {
      if (seen.has(member.id) || seen.size >= state.tree.members.length) {
        throw new Error("Invalid saved family genealogy");
      }
      seen.add(member.id);
      queue.push(member.id);
    }
  }
  return queue.length - 1;
}

function drawHiddenCounts(state) {
  for (let index = 7; index < PLATES.length; index++) {
    const member = state.slots.members[index],
      [x, y] = PLATES[index];
    treeText(
      state,
      member ? descendantCount(state, member.id) : 0,
      { x, y: y + 58, width: 133 },
      "#aaaaaa",
    );
  }
  let remaining = 0,
    member = state.slots.members[1];
  const seen = new Set();
  while (member?.parentId) {
    if (seen.has(member.id) || seen.size >= state.tree.members.length) {
      throw new Error("Invalid saved family ancestry");
    }
    seen.add(member.id);
    member = state.slots.byId.get(member.parentId);
    if (member) remaining++;
  }
  treeText(state, remaining, { x: 275, y: 80, width: 40 }, "#aaaaaa");
}
