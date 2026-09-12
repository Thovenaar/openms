const THEME_KEY = "maple-inspection-theme-v1";
const CONSOLE_KEY = "maple-inspection-sidebar-v1";
const THEMES = new Set(["win95", "xp"]);
const PANELS = ["play", "character", "inspect", "settings", "agent"];

/** Select one external task without rebuilding controls or losing draft values. */
export function showInspectionPanel(id) {
  if (!PANELS.includes(id)) throw new Error(`Unknown tool section: ${id}`);
  setConsoleVisible(true);
  for (const name of PANELS) {
    const selected = name === id;
    const tab = document.getElementById(`console-tab-${name}`);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(`console-${name}`).hidden = !selected;
  }
}

function setConsoleVisible(visible, persist = true) {
  const console = document.querySelector("#gm-console");
  const button = document.querySelector("#console-toggle");
  const label = visible
    ? "Minimize development tools"
    : "Expand development tools";
  console.hidden = !visible;
  button.setAttribute("aria-expanded", String(visible));
  button.setAttribute("aria-label", label);
  button.title = label;
  if (!visible && console.contains(document.activeElement)) button.focus();
  if (!persist) return;
  try {
    localStorage.setItem(CONSOLE_KEY, visible ? "open" : "closed");
  } catch (error) {
    document.querySelector("#ui-status").textContent =
      `Sidebar changed for this session only: ${error.message}`;
  }
}

function toggleConsole() {
  setConsoleVisible(document.querySelector("#gm-console").hidden);
}

function closeConsoleOnEscape(event) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (event.target.closest("input, textarea, select")) return;
  event.preventDefault();
  event.stopPropagation();
  setConsoleVisible(false);
}

function initializeSidebar(signal) {
  const defaultOpen = window.matchMedia("(min-width: 961px)").matches;
  try {
    const saved = localStorage.getItem(CONSOLE_KEY);
    setConsoleVisible(
      saved === "open" || (saved !== "closed" && defaultOpen),
      false,
    );
  } catch (error) {
    setConsoleVisible(defaultOpen, false);
    document.querySelector("#ui-status").textContent =
      `Saved sidebar preference unavailable: ${error.message}`;
  }
  document
    .querySelector("#console-toggle")
    .addEventListener("click", toggleConsole, { signal });
  document
    .querySelector("#gm-console")
    .addEventListener("keydown", closeConsoleOnEscape, { signal });
}

function selectPanel(event) {
  showInspectionPanel(event.currentTarget.dataset.consolePanel);
}

function navigatePanels(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  let index = PANELS.indexOf(event.currentTarget.dataset.consolePanel);
  switch (event.key) {
    case "ArrowLeft":
      index = (index + PANELS.length - 1) % PANELS.length;
      break;
    case "ArrowRight":
      index = (index + 1) % PANELS.length;
      break;
    case "Home":
      index = 0;
      break;
    case "End":
      index = PANELS.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  showInspectionPanel(PANELS[index]);
  document.getElementById(`console-tab-${PANELS[index]}`).focus();
}

/** Own theme and navigation listeners; no body/viewport theme inheritance. */
export function initializeInspectionTheme(signal) {
  const choices = document.querySelector("#inspection-theme");
  const roots = document.querySelectorAll(".inspection-chrome");
  const status = document.querySelector("#theme-status");
  function apply(value) {
    const theme = THEMES.has(value) ? value : "win95";
    for (const root of roots) root.dataset.inspectionTheme = theme;
    for (const input of choices.querySelectorAll("input")) {
      input.checked = input.value === theme;
    }
    return theme;
  }
  function change(event) {
    if (!event.target.matches('input[name="inspection-theme"]')) return;
    const value = apply(event.target.value);
    try {
      localStorage.setItem(THEME_KEY, value);
      status.textContent = "Tool appearance saved. Game artwork is unchanged.";
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
  choices.addEventListener("change", change, { signal });
  initializeSidebar(signal);
  for (const id of PANELS) {
    const tab = document.getElementById(`console-tab-${id}`);
    tab.addEventListener("click", selectPanel, { signal });
    tab.addEventListener("keydown", navigatePanels, { signal });
  }
}
