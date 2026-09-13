import { resolve } from "node:path";
import { OnlineUI } from "../../client/src/online/ui.js";
import { NativeSocial } from "../../client/src/online/native-social.js";
import { nativeInterfaceHooks } from "../../client/src/ingame-interfaces.js";
import { NORMAL_UI_NAMES } from "../../client/src/ui/game-ui.js";
import { ACTION_KINDS } from "../../shared/protocol.js";
import { SOCIAL_ACTIONS } from "../../shared/social-protocol.js";
import { CONTACT_ACTIONS } from "../../client/src/social/local-social-actions.js";
import { GROUP_ACTIONS } from "../../client/src/social/local-social-groups.js";
import { BOARD_ACTIONS } from "../../client/src/social/local-social-board.js";
import { FAMILY_ACTIONS } from "../../client/src/social/local-social-family.js";
import { INVITATION_ACTIONS } from "../../client/src/social/local-social-invitations.js";

const ROOT = resolve(import.meta.dir, "../..");
const MAX_FILES = 512;

async function sourceFiles(directory) {
  const paths = [
    ...new Bun.Glob("*.js").scanSync({ cwd: resolve(ROOT, directory) }),
  ].sort();
  if (paths.length > MAX_FILES) throw new Error("Audit file bound exceeded");
  const files = [];
  for (const path of paths) {
    const source = Bun.file(resolve(ROOT, directory, path));
    if (source.size > 512 * 1024) {
      throw new Error("Audit source byte bound exceeded");
    }
    files.push({ path: `${directory}/${path}`, text: await source.text() });
  }
  return files;
}
function references(files, kind) {
  return files
    .filter(({ text }) => text.includes(`"${kind}"`))
    .map(({ path }) => path);
}

/** Static wiring inventory; literal references and declared hooks are NOT execution proof. */
async function audit() {
  const owner = Object.create(OnlineUI.prototype);
  owner.hooks = {};
  owner.social = new NativeSocial(owner);
  const onlineHooks = Object.keys(owner.nativeHooks()).sort();
  const offlineHooks = Object.keys(nativeInterfaceHooks({})).sort();
  const socialRules = {
    ...CONTACT_ACTIONS,
    ...GROUP_ACTIONS,
    ...BOARD_ACTIONS,
    ...FAMILY_ACTIONS,
    ...INVITATION_ACTIONS,
  };
  const client = await sourceFiles("client/src/online");
  const server = await sourceFiles("server/src");
  return {
    schema: 1,
    evidence:
      "Static declaration/reference inventory. Runtime admission, recipient delivery, content completeness and original Windows raster parity require separate proof.",
    ordinaryBindings: NORMAL_UI_NAMES,
    onlineHooks,
    missingOfflineInterfaceHooks: offlineHooks.filter(
      (key) => !onlineHooks.includes(key),
    ),
    actions: ACTION_KINDS.map((kind) => ({
      kind,
      browserReferences: references(client, kind),
      serverReferences: references(server, kind),
    })),
    socialActions: SOCIAL_ACTIONS.map((kind) => ({
      kind,
      sharedServerRule: Object.hasOwn(socialRules, kind),
    })),
  };
}
const result = await audit();
await Bun.write(
  resolve(ROOT, "docs/server/online-feature-audit.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    actions: result.actions.length,
    socialActions: result.socialActions.length,
    missingHooks: result.missingOfflineInterfaceHooks,
    missingSocialRules: result.socialActions.filter(
      (entry) => !entry.sharedServerRule,
    ),
  }),
);
