const ROOT = "UserList/Party/PartyHP";
const MAX_PARTY_MEMBERS = 6; // 0091f934/0091fada iterate the six native party slots.
const FONT = "12px Arial,sans-serif"; // 0098a707 fonts1/2, string0x1597.
const GAUGE_WIDTH = 64; // 009203fb/0092041e: integer health ratio shifted by six.

/** Native0091f001/0091f934/0091fada. Borrows UserList's atlas; never owns a second decoder. */
export function layoutPartyHP(panel, social) {
  const view = social.snapshot();
  if (!view.party) {
    throw new Error("Party health requires a current local party");
  }
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("Party health requires Canvas2D font metrics");
  measure.font = FONT;
  const layer = panel.layer("Party health");
  const metric = layer.text("M", 0, 0, 100);
  metric.style.cssText += `font:${FONT};line-height:normal;visibility:hidden;`;
  // Browser font height substitutes for IWzFont::height; original Windows glyph metrics are unavailable.
  const fontHeight = metric.offsetHeight;
  metric.remove();
  if (fontHeight <= 0) {
    throw new Error("Party health font metrics are unavailable");
  }
  const state = {
    panel,
    social,
    layer,
    measure,
    fontHeight,
    selfId: view.self.id,
    frame: {},
    rows: [],
    gaugeRect: { x: 0, y: 0, width: 0, height: 0 },
  };
  for (const name of ["nw", "n", "ne", "w", "c", "e", "sw", "s", "se"]) {
    state.frame[name] = layer.image(`${ROOT}/${name}`, 0, 0);
  }
  for (let index = 0; index < MAX_PARTY_MEMBERS; index++) {
    state.rows.push(createRow(layer));
  }
  panel.partyHpRows = state.rows;
  panel.localRefresh = () => refreshPartyHP(state);
  panel.cleanups.push(social.subscribe(panel.localRefresh));
  panel.cleanups.push(() => {
    panel.partyHpRows = null;
    panel.localRefresh = null;
  });
  refreshPartyHP(state);
}

function createRow(layer) {
  const name = layer.text("", 5, 5, 100);
  name.style.cssText += `font:${FONT};line-height:normal;white-space:nowrap;overflow:hidden;`;
  const bar = layer.image(`${ROOT}/GaugeBar/bar`, 0, 0);
  const gauge = layer.image(`${ROOT}/GaugeBar/gauge`, 0, 0);
  const graduation = layer.image(`${ROOT}/GaugeBar/graduation`, 0, 0);
  const health = layer.text("", 0, 0, GAUGE_WIDTH);
  health.setAttribute("role", "progressbar");
  health.style.height = "7px";
  return {
    name,
    health,
    bar,
    gauge,
    graduation,
    id: null,
    hp: null,
    maxHp: null,
    extent: 0,
    present: false,
  };
}

/** Stretch only the original one-pixel repeat axes, keeping authored origins and atlas crops. */
function place(layer, sprite, path, rect) {
  const asset = layer.assets[`${ROOT}/${path}`];
  const sx = rect.width / asset.width,
    sy = rect.height / asset.height;
  sprite.container.scale.set(sx, sy);
  sprite.setPosition(
    rect.x + asset.origin.x * sx,
    rect.y + asset.origin.y * sy,
  );
}

function resizeFrame(state, width, height) {
  const { panel, layer, frame } = state;
  panel.width = width;
  panel.height = height;
  panel.element.style.width = `${width}px`;
  panel.element.style.height = `${height}px`;
  layer.element.style.width = `${width}px`;
  layer.element.style.height = `${height}px`;
  if (panel.dragStrip) panel.dragStrip.style.width = `${width}px`;
  // 0091fada repeats the one-pixel center/edges between the original asymmetric 5/144px sides.
  const middle = width - 149,
    body = height - 14;
  place(layer, frame.nw, "nw", { x: 0, y: 0, width: 5, height: 7 });
  place(layer, frame.n, "n", { x: 5, y: 0, width: middle, height: 7 });
  place(layer, frame.ne, "ne", { x: width - 144, y: 0, width: 144, height: 7 });
  place(layer, frame.w, "w", { x: 0, y: 7, width: 5, height: body });
  place(layer, frame.c, "c", { x: 5, y: 7, width: middle, height: body });
  place(layer, frame.e, "e", {
    x: width - 144,
    y: 7,
    width: 144,
    height: body,
  });
  place(layer, frame.sw, "sw", { x: 0, y: height - 7, width: 5, height: 7 });
  place(layer, frame.s, "s", { x: 5, y: height - 7, width: middle, height: 7 });
  place(layer, frame.se, "se", {
    x: width - 144,
    y: height - 7,
    width: 144,
    height: 7,
  });
}

function refreshPartyHP(state) {
  const { panel, social, measure, fontHeight } = state;
  if (panel.disposed) return;
  const view = social.snapshot();
  if (!view.party || view.self.id !== state.selfId) {
    for (const row of state.rows) hideRow(row);
    panel.renderArtwork();
    panel.owner.close("PartyHP");
    return;
  }
  const members = view.party.members;
  if (members.length < 1 || members.length > MAX_PARTY_MEMBERS) {
    throw new Error("Invalid native party health roster size");
  }
  const width = partyNameWidth(measure, members);
  const height = 5 + (fontHeight + 5) * members.length;
  if (panel.width !== width || panel.height !== height || !state.sized) {
    resizeFrame(state, width, height);
    state.sized = true;
  }
  for (let index = 0; index < MAX_PARTY_MEMBERS; index++) {
    const member = members[index],
      row = state.rows[index];
    if (!member) hideRow(row);
    else refreshRow(state, row, member, { mapId: view.self.mapId, index });
  }
  panel.renderArtwork();
}

function partyNameWidth(measure, members) {
  let width = 150;
  for (const member of members) {
    width = Math.max(
      width,
      Math.ceil(measure.measureText(member.name).width) + 100,
    );
  }
  return width;
}

function validPartyHealth(hp, maxHp) {
  return (
    Number.isSafeInteger(hp) &&
    hp >= 0 &&
    Number.isSafeInteger(maxHp) &&
    maxHp > 0
  );
}

function hideRow(row) {
  row.name.hidden = true;
  row.health.hidden = true;
  row.bar.container.visible = false;
  row.gauge.container.visible = false;
  row.graduation.container.visible = false;
  row.id = null;
  row.hp = null;
  row.maxHp = null;
  row.extent = 0;
  row.present = false;
}

function updateRowHealth(state, row, member, mapId) {
  // Native009716ed resolves a field user; server presence supplies this projection.
  const present =
    member.online === true &&
    member.hp !== null &&
    member.maxHp !== null &&
    Boolean(state.social.getParticipant(member.id)) &&
    member.mapId === mapId;
  const hp = member.hp,
    maxHp = member.maxHp;
  const validHealth = validPartyHealth(hp, maxHp);
  if (present && !validHealth) {
    throw new Error("Loaded party participant has invalid saved health");
  }
  const extent = present
    ? Math.min(GAUGE_WIDTH, Math.floor((GAUGE_WIDTH * hp) / maxHp))
    : 0;
  row.id = member.id;
  row.hp = validHealth ? hp : null;
  row.maxHp = validHealth ? maxHp : null;
  row.extent = extent;
  row.present = present;
}

function refreshRow(state, row, member, location) {
  updateRowHealth(state, row, member, location.mapId);
  const { panel, fontHeight } = state;
  const { hp, maxHp, present } = row;
  const y = 5 + (fontHeight + 5) * location.index;
  row.name.hidden = false;
  row.name.textContent = member.name;
  row.name.style.top = `${y}px`;
  row.name.style.width = `${panel.width - 100}px`;
  row.name.style.color = present ? "#000000" : "#404040";
  row.health.hidden = false;
  row.health.style.left = `${panel.width - 72}px`;
  row.health.style.top = `${y + 3}px`;
  row.health.setAttribute("aria-label", `${member.name} health`);
  row.health.setAttribute("aria-valuemin", "0");
  row.health.setAttribute(
    "aria-valuemax",
    String(present ? maxHp : GAUGE_WIDTH),
  );
  row.health.setAttribute("aria-valuenow", String(present ? hp : 0));
  row.health.setAttribute(
    "aria-valuetext",
    present ? `${hp} / ${maxHp}` : "Not present in the current map",
  );
  positionRowGauge(state, row, y);
}

function positionRowGauge(state, row, y) {
  const { panel, layer } = state;
  const rect = state.gaugeRect;
  row.bar.container.visible = true;
  row.graduation.container.visible = true;
  row.gauge.container.visible = row.extent > 0;
  rect.x = panel.width - 72;
  rect.y = y + 3;
  rect.width = 63;
  rect.height = 7;
  place(layer, row.bar, "GaugeBar/bar", rect);
  rect.width = row.extent;
  place(layer, row.gauge, "GaugeBar/gauge", rect);
  rect.x = panel.width - 75;
  rect.y = y;
  rect.width = 69;
  rect.height = 13;
  place(layer, row.graduation, "GaugeBar/graduation", rect);
}
