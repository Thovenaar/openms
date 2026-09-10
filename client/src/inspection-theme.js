const THEME_KEY = "maple-inspection-theme-v1";
const THEMES = new Set(["xp", "win95", "y2k"]);
const PANELS = ["play", "character", "inspect", "settings"];

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

function setConsoleVisible(visible) {
  document.querySelector("#gm-console").hidden = !visible;
  const button = document.querySelector("#console-toggle");
  button.setAttribute("aria-expanded", String(visible));
  button.textContent = visible ? "Hide tools" : "Show tools";
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
  select.addEventListener("change", change, { signal });
  for (const id of PANELS) {
    const tab = document.getElementById(`console-tab-${id}`);
    tab.addEventListener("click", selectPanel, { signal });
    tab.addEventListener("keydown", navigatePanels, { signal });
  }
  document.querySelector("#console-toggle").addEventListener(
    "click",
    () => {
      setConsoleVisible(document.querySelector("#gm-console").hidden);
    },
    { signal },
  );
}
