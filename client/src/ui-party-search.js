import {
  socialView,
  replaceSocialLayer,
  socialText,
  socialTabs,
  socialButton,
  socialList,
  admitted,
  socialPrompt,
  memberText,
} from "./ui-social-controls.js";
import { JOB_LABELS } from "./ui-job-labels.js";

// 0087796a controls7001..7025 retain the original job families, not invented candidates.
const JOBS = [
  0, 2100, 100, 110, 120, 130, 1110, 200, 210, 220, 230, 1210, 500, 510, 520,
  1510, 400, 410, 420, 1410, 300, 310, 320, 1310,
];

export function layoutPartySearch(panel, social) {
  const state = socialView(panel, social, drawPartySearch);
  state.tab = 0;
  state.criteria = { minLevel: 1, maxLevel: 200, jobs: [], text: "" };
  const registration = state.view.partySearch.find(
    (entry) => entry.id === state.view.self.id,
  );
  if (registration) {
    state.criteria = {
      minLevel: registration.minLevel,
      maxLevel: registration.maxLevel,
      jobs: [...registration.jobs],
      text: registration.text,
    };
  }
  state.editing = false;
  state.refresh();
}

function drawPartySearch(state) {
  replaceSocialLayer(state, "PartySearch/backgrnd");
  socialTabs(state, {
    path: "PartySearch/Tab",
    x: 12,
    y: 24,
    width: 100,
    labels: ["Find party", "Find party member"],
    selected: state.tab,
    select: (tab) => {
      state.tab = tab;
      state.position = 0;
      state.refresh();
    },
  });
  const registered = state.view.partySearch.find(
    (entry) => entry.id === state.view.self.id,
  );
  state.registration = registered;
  const branch = state.tab === 0 ? "Party" : "PartyMember";
  state.layer.image(`PartySearch/${branch}/party0`, 12, 45);
  if (!registered || state.editing) drawSearchCriteria(state);
  else drawSearchResults(state);
  searchButtons(state);
  state.restoreFocus();
}

function drawSearchCriteria(state) {
  const fields = state.criteria;
  state.layer.image("PartySearch/Party/party2", 12, 84);
  socialText(state.layer, `${fields.minLevel}`, { x: 72, y: 84, width: 27 });
  socialText(state.layer, `${fields.maxLevel}`, { x: 121, y: 84, width: 27 });
  state.layer.hit(
    "Minimum search level",
    { x: 70, y: 84, width: 28, height: 18 },
    { click: () => editLevel(state, "minLevel") },
  );
  state.layer.hit(
    "Maximum search level",
    { x: 120, y: 84, width: 28, height: 18 },
    { click: () => editLevel(state, "maxLevel") },
  );
  socialText(state.layer, "Jobs", { x: 17, y: 110, width: 90 }, { bold: true });
  for (let index = 0; index < JOBS.length; index++) {
    drawJobChoice(state, JOBS[index], index);
  }
  socialText(
    state.layer,
    fields.text,
    { x: 17, y: 322, width: 266, height: 33 },
    { wrap: true },
  );
  state.layer.hit(
    "Search message",
    { x: 17, y: 322, width: 266, height: 33 },
    { click: () => editSearchMessage(state) },
    { tooltip: "Edit your party search message." },
  );
}

function drawJobChoice(state, job, index) {
  const x = 12 + Math.floor(index / 8) * 94;
  const y = 132 + (index % 8) * 22;
  const selected = state.criteria.jobs.includes(job);
  state.layer.image(`PartySearch/check${selected ? 1 : 0}`, x, y);
  const label = JOB_LABELS[job] || `Job ${job}`;
  socialText(state.layer, label, { x: x + 15, y: y - 1, width: 74 });
  const hit = state.layer.hit(
    label,
    { x, y, width: 89, height: 18 },
    {
      click: () => {
        if (selected) {
          state.criteria.jobs.splice(state.criteria.jobs.indexOf(job), 1);
        } else state.criteria.jobs.push(job);
        state.refresh();
      },
    },
  );
  hit.setAttribute("role", "checkbox");
  hit.setAttribute("aria-checked", String(selected));
}

async function editLevel(state, field) {
  try {
    const result = await socialPrompt(state, {
      kind: "number",
      text: field === "minLevel" ? "Minimum level" : "Maximum level",
      value: state.criteria[field],
      min: 1,
      max: 200,
    });
    if (result !== null) {
      state.criteria[field] = result;
      state.refresh();
    }
  } catch (error) {
    state.panel.owner.report(error);
  }
}

async function editSearchMessage(state) {
  try {
    const result = await socialPrompt(state, {
      kind: "text",
      text: "Enter your party search message.",
      value: state.criteria.text,
      maxLength: 100,
    });
    if (result !== null) {
      state.criteria.text = result;
      state.refresh();
    }
  } catch (error) {
    state.panel.owner.report(error);
  }
}

function drawSearchResults(state) {
  const self = state.view.self;
  const rows = state.view.partySearch.filter((entry) =>
    matchesSearch(state, entry, self),
  );
  socialList(
    state,
    rows,
    { x: 13, y: 84, width: 266, height: 264 },
    {
      rowHeight: 44,
      wrap: true,
      label: (row) => `${memberText(row)}\n${row.mapName}  ${row.text}`,
      tooltip: (row) =>
        `${row.name}\nLevels ${row.minLevel}–${row.maxLevel}\n${row.text}\nDouble-click to invite.`,
      activate: (row) =>
        state.social.execute("search.invite", { targetId: row.id }),
      empty: state.registration.paused
        ? "Party search is paused."
        : "There are no matching registered characters.",
    },
  );
}

function matchesSearch(state, entry, self) {
  if (entry.id === self.id || entry.paused || state.registration.paused) {
    return false;
  }
  if (state.tab === 0) {
    return Boolean(entry.partyId) && matchesCriteria(self, entry);
  }
  return !entry.partyId && matchesCriteria(entry, state.registration);
}

function matchesCriteria(member, criteria) {
  return (
    member.level >= criteria.minLevel &&
    member.level <= criteria.maxLevel &&
    (!criteria.jobs.length || criteria.jobs.includes(member.job))
  );
}

function searchButtons(state) {
  const registered = state.registration;
  const action = registered ? "search.update" : "search.register";
  const active = Boolean(registered && !registered.paused);
  socialButton(state, {
    path: "PartySearch/BtStart",
    x: 5,
    y: 373,
    label: "Start party search",
    enabled: () => admitted(state, action) && (!active || state.editing),
    action: async () => {
      const outcome = await state.social.execute(action, {
        ...state.criteria,
        paused: false,
      });
      if (outcome.ok) state.editing = false;
      return outcome;
    },
  });
  socialButton(state, {
    path: "PartySearch/BtPause",
    x: 73,
    y: 373,
    label: "Pause party search",
    enabled: () => admitted(state, "search.update") && active,
    action: () => state.social.execute("search.update", { paused: true }),
  });
  socialButton(state, {
    path: "PartySearch/BtStop",
    x: 141,
    y: 373,
    label: "Stop party search",
    enabled: () => admitted(state, "search.remove") && Boolean(registered),
    action: () => state.social.execute("search.remove"),
  });
  socialButton(state, {
    path: state.editing ? "PartySearch/BtCancel" : "PartySearch/BtReg",
    x: 241,
    y: 373,
    label: state.editing ? "Cancel criteria changes" : "Registration criteria",
    action: () => {
      state.editing = !state.editing;
      if (registered) {
        state.criteria = {
          minLevel: registered.minLevel,
          maxLevel: registered.maxLevel,
          jobs: [...registered.jobs],
          text: registered.text,
        };
      }
    },
  });
}
