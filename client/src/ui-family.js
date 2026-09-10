import {
  socialView,
  replaceSocialLayer,
  socialText,
  socialButton,
  requestTarget,
  requestText,
  confirmSocial,
  admitted,
  socialHook,
  socialPrompt,
} from "./ui-social-controls.js";

/** Family0080862b/008091d2: entitlement arrows cycle actual authority entries. */
export function layoutFamily(panel, social) {
  const state = socialView(panel, social, drawFamily);
  state.entitlementIndex = 0;
  state.refresh();
}

function drawFamily(state) {
  replaceSocialLayer(state, "Family/backgrnd");
  const family = state.view.family;
  drawFamilyDetails(state, family);
  drawFamilyControls(state, family);
  drawEntitlement(state);
  socialButton(state, {
    path: "Family/BtOK",
    x: 93,
    y: 368,
    label: "Close family",
    action: () => state.panel.owner.close(state.panel.name),
  });
  state.restoreFocus();
}

function drawFamilyDetails(state, family) {
  const self = family?.members.find(
    (member) => member.id === state.view.self.id,
  );
  const juniors =
    family?.members.filter(
      (member) => member.parentId === state.view.self.id,
    ) || [];
  socialText(
    state.layer,
    state.view.self.name,
    { x: 14, y: 31, width: 194 },
    { bold: true, color: "#ffffff" },
  );
  socialText(state.layer, family?.precept || "", { x: 14, y: 56, width: 187 });
  socialText(state.layer, `${juniors.length} / 2`, { x: 48, y: 80, width: 44 });
  socialText(state.layer, String(self?.reputation || 0), {
    x: 53,
    y: 111,
    width: 150,
  });
  socialText(state.layer, String(self?.todayReputation || 0), {
    x: 99,
    y: 129,
    width: 106,
  });
}

function drawFamilyControls(state, family) {
  socialButton(state, {
    path: "Family/BtJuniorEntry",
    x: 95,
    y: 77,
    label: "Add junior",
    enabled: () => admitted(state, "family.invite"),
    action: () =>
      requestTarget(
        state,
        "family.invite",
        "Enter the name of the character you wish to add as Junior. You must be in the same map.",
      ),
  });
  socialButton(state, {
    path: "Family/BtTree",
    x: 164,
    y: 77,
    label: "View pedigree",
    action: () => socialHook(state, "openFamilyTree", state.view.self.id),
  });
  socialButton(state, {
    path: "Family/BtFamilyPrecept",
    x: 209,
    y: 55,
    label: "Family precept",
    enabled: () => admitted(state, "family.precept"),
    action: () =>
      requestText(state, "family.precept", {
        text: "Enter the family precept.",
        value: family?.precept || "",
        maxLength: 200,
      }),
  });
}

function drawEntitlement(state) {
  const entries = state.view.family?.entitlements || [];
  state.entitlementIndex = entries.length
    ? state.entitlementIndex % entries.length
    : 0;
  const entry = entries[state.entitlementIndex];
  drawEntitlementArrows(state, entries);
  drawEntitlementDetails(state, entry);
  const icon = entitlementIcon(entry);
  if (icon !== null) state.layer.image(`Family/RightIcon/${icon}`, 21, 313);
  socialButton(state, {
    path: "Family/BtSpecial",
    x: 152,
    y: 322,
    label: "Use entitlement",
    enabled: () =>
      Boolean(entry?.available) && admitted(state, "family.entitlement"),
    tooltip: entry?.reason || entry?.description,
    action: () => useEntitlement(state, entry),
  });
}

function drawEntitlementArrows(state, entries) {
  const cycle = (delta) => {
    state.entitlementIndex =
      (state.entitlementIndex + entries.length + delta) % entries.length;
  };
  socialButton(state, {
    path: "Family/BtLeft",
    x: 15,
    y: 177,
    label: "Previous entitlement",
    enabled: entries.length > 1,
    action: () => cycle(-1),
  });
  socialButton(state, {
    path: "Family/BtRight",
    x: 196,
    y: 177,
    label: "Next entitlement",
    enabled: entries.length > 1,
    action: () => cycle(1),
  });
}

function drawEntitlementDetails(state, entry) {
  socialText(state.layer, entry?.name || "No family entitlements", {
    x: 31,
    y: 177,
    width: 160,
  });
  socialText(state.layer, String(entry?.cost || 0), {
    x: 71,
    y: 196,
    width: 47,
  });
  socialText(state.layer, String(Number(Boolean(entry?.used))), {
    x: 169,
    y: 196,
    width: 35,
  });
  socialText(
    state.layer,
    entitlementDescription(entry),
    { x: 18, y: 217, width: 187, height: 95 },
    { wrap: true },
  );
}

function entitlementDescription(entry) {
  return (
    entry?.reason ||
    entry?.description ||
    entry?.name ||
    "Add a junior to form a family. Reputation and privileges are recorded by the family authority."
  );
}

function entitlementIcon(entry) {
  if (entry?.kind === "exp") return entry.party ? 2 : 0;
  if (entry?.kind === "drop") return entry.party ? 3 : 1;
  return entry?.kind === "bonding" ? 4 : null;
}

async function useEntitlement(state, entry) {
  const payload = { entitlement: entry.id };
  if (entry.kind === "travel" || entry.kind === "summon") {
    const name = await socialPrompt(state, {
      kind: "text",
      text: "Enter the name of the family member.",
      maxLength: 12,
    });
    if (name === null) return { ok: false, code: "cancelled" };
    const member = state.view.family?.members.find(
      (member) =>
        member.name.toLowerCase() === name.trim().toLowerCase() &&
        member.id !== state.view.self.id,
    );
    if (!member) {
      return {
        ok: false,
        code: "family-member",
        reason: "Choose another loaded member of your own family.",
      };
    }
    payload.targetId = member.id;
  }
  return confirmSocial(
    state,
    "family.entitlement",
    `Use ${entry.name} for ${entry.cost} reputation?`,
    payload,
  );
}
