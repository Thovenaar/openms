// Browser policy: one online client per storage origin.
// Keep this name stable across builds/accounts so an older tab still owns it.
const LOCK_NAME = "openms.game-tab";

/** Leave document loading free to finish while the game waits for admission. */
export function startGameTab(load) {
  requireGameTab()
    .then(load)
    .catch((error) => {
      const gate = createGate();
      document.querySelector("main").inert = true;
      gate.title.textContent = "Unable to start MapleStory";
      gate.message.textContent =
        "The game could not load. Try again to reload this tab.";
      gate.button.hidden = false;
      gate.button.focus();
      console.error("Game startup failed:", error);
    });
}

/** Acquire before constructing a client, opening saves or admitting a session.
 * The unresolved callback owns the lock for this document's entire lifetime;
 * the browser releases it on navigation, close or crash, without stale timers. */
export function requireGameTab() {
  const ready = Promise.withResolvers();
  const lifetime = Promise.withResolvers();
  const main = document.querySelector("main");
  const gate = createGate();
  main.inert = true;
  document.body.dataset.gameTab = "checking";
  // A restored document must re-enter the gate before resuming old game state.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
  if (!navigator.locks?.request) {
    unavailable(gate);
    return ready.promise;
  }
  navigator.locks
    .request(LOCK_NAME, { mode: "exclusive", ifAvailable: true }, (lock) => {
      if (!lock) {
        document.body.dataset.gameTab = "blocked";
        gate.title.textContent = "MapleStory is already open";
        gate.message.textContent =
          "Use your other game tab, or close it and try again here.";
        gate.button.hidden = false;
        gate.button.focus();
        return;
      }
      document.body.dataset.gameTab = "active";
      main.inert = false;
      gate.root.remove();
      ready.resolve();
      return lifetime.promise;
    })
    .catch((error) => {
      unavailable(gate);
      console.error("Game tab lock failed:", error);
    });
  return ready.promise;
}

function unavailable(gate) {
  document.body.dataset.gameTab = "unavailable";
  gate.title.textContent = "Unable to start MapleStory";
  gate.message.textContent =
    "This browser could not protect your game session. Open this site in Chrome using localhost or HTTPS, then try again.";
  gate.button.hidden = false;
  gate.button.focus();
}

/** Plain startup chrome works before any original artwork or save is loaded. */
function createGate() {
  const root = document.createElement("section");
  root.id = "game-tab-gate";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "game-tab-title");
  root.setAttribute("aria-describedby", "game-tab-message");
  const card = document.createElement("div");
  const title = document.createElement("h1");
  title.id = "game-tab-title";
  title.textContent = "Opening MapleStory…";
  const message = document.createElement("p");
  message.id = "game-tab-message";
  message.textContent = "Checking for another game tab…";
  message.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Try again";
  button.hidden = true;
  button.addEventListener("click", () => window.location.reload());
  card.append(title, message, button);
  root.append(card);
  document.body.append(root);
  return { root, title, message, button };
}
