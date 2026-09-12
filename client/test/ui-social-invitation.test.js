import { expect, test } from "bun:test";
import { layoutSocialInvitation } from "../src/ui/ui-trade-invitation.js";

function invitationPanel(owner) {
  return {
    owner,
    name: "SocialInvitation",
    element: { style: {} },
    cleanups: [],
    image() {},
    text() {
      return { style: { cssText: "" } };
    },
    button() {},
  };
}

test("incoming consent sounds once across repaint and fade updates, then sounds for the next request", () => {
  let clock = 0;
  const sounds = [];
  const owner = {
    hooks: { now: () => clock },
    sound: (name) => sounds.push(name),
  };
  for (const kind of ["friend", "party", "guild"]) {
    const invitation = {
      request: { kind, fromName: "Local peer" },
      answer() {},
    };
    const before = sounds.length;
    const panel = invitationPanel(owner);
    layoutSocialInvitation(panel, invitation);
    expect(sounds.slice(before)).toEqual(["Invite"]);
    clock += 500;
    panel.invitationUpdate();
    clock += 1000;
    panel.invitationUpdate();
    layoutSocialInvitation(invitationPanel(owner), invitation);
    expect(sounds.slice(before)).toEqual(["Invite"]);
  }
});
