const THEME_KEY = "maple-inspection-theme-v1";
const THEMES = new Set(["xp", "win95", "y2k"]);
const MAX_DETAILS_DEPTH = 8;

/** Own theme state on the two external roots; no body/viewport inheritance. */
export function initializeInspectionTheme(signal) {
  const select = document.querySelector("#inspection-theme");
  const roots = document.querySelectorAll(".inspection-chrome");
  const status = document.querySelector("#theme-status");
  function apply(value) {
    if (!THEMES.has(value)) return;
    for (const root of roots) root.dataset.inspectionTheme = value;
    select.value = value;
  }
  function change() {
    apply(select.value);
    try {
      localStorage.setItem(THEME_KEY, select.value);
      status.textContent = "Console theme saved. Game artwork is unchanged.";
    } catch (error) {
      status.textContent = `Theme applied for this session only: ${error.message}`;
      status.classList.remove("sr-only");
    }
  }
  try {
    apply(localStorage.getItem(THEME_KEY));
  } catch (error) {
    status.textContent = `Saved theme unavailable: ${error.message}`;
    status.classList.remove("sr-only");
  }
  select.addEventListener("change", change, { signal });
  for (const button of document.querySelectorAll("[data-console-target]")) {
    button.addEventListener("click", openConsoleSection, { signal });
  }
}

/** Reveal a bounded chain of console details, then move keyboard focus. */
function openConsoleSection(event) {
  const target = document.getElementById(
    event.currentTarget.dataset.consoleTarget,
  );
  const status = document.querySelector("#theme-status");
  if (!target) {
    status.classList.remove("sr-only");
    status.textContent =
      "This console section is unavailable until the field finishes loading.";
    return;
  }
  let node = target;
  for (let depth = 0; node && depth < MAX_DETAILS_DEPTH; depth++) {
    if (node.tagName === "DETAILS") node.open = true;
    if (node.id === "gm-console") break;
    node = node.parentElement;
  }
  target.scrollIntoView({ block: "nearest" });
  target.querySelector("summary, button, input, select")?.focus();
}
