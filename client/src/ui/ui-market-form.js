import { MARKET_LIMITS } from "../../../shared/market-protocol.js";

function field(form, label, value, [min, max]) {
  const row = document.createElement("label");
  row.style.cssText =
    "display:grid;grid-template-columns:180px 1fr;gap:8px;margin:12px 0";
  row.append(document.createTextNode(label));
  const input = document.createElement("input");
  input.type = "number";
  input.min = min;
  input.max = max;
  input.step = "1";
  input.required = true;
  input.value = String(value);
  input.setAttribute("aria-label", label);
  row.append(input);
  form.append(row);
  return input;
}

/** OpenMS form placement inside the original ITC stage; all numeric bounds are rechecked by the server. */
export function openMarketForm(panel, item = null, wanted = false) {
  if (panel.marketForm || panel.market.pending) return;
  const region = panel.contentArea(280, 125, 491, 350);
  region.style.cssText +=
    ";background:#e9f1fa;border:2px ridge #fff;padding:15px;color:#142941;font:12px Arial,sans-serif;z-index:10;";
  region.setAttribute("role", "dialog");
  region.setAttribute(
    "aria-label",
    wanted ? "Create wanted order" : "List an item",
  );
  panel.marketForm = region;
  const form = document.createElement("form");
  const title = document.createElement("h3");
  title.textContent = wanted
    ? "Wanted order"
    : panel.owner.index.items[item.id].name;
  form.append(title);
  const values = formFields(form, item, wanted, panel);
  const note = document.createElement("p");
  note.textContent =
    "Price is for the entire lot. The seller receives 95% of the price, rounded down. Wanted orders reserve NX immediately.";
  form.append(note);
  const error = document.createElement("p");
  error.setAttribute("role", "status");
  form.append(error);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = wanted ? "Place wanted order" : "Register listing";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.style.marginLeft = "12px";
  cancel.addEventListener("click", () => closeMarketForm(panel));
  form.append(submit, cancel);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || panel.market.pending) return;
    const result = await panel.market.run(formRequest(values, item, wanted));
    if (result.ok) closeMarketForm(panel);
    else error.textContent = result.reason;
  });
  region.append(form);
  region.querySelector("input").focus();
}

function formFields(form, item, wanted, panel) {
  const values = {};
  if (wanted) values.item = wantedItem(form, panel.owner.index.items);
  values.quantity = field(form, "Quantity", 1, [1, item?.count ?? 32767]);
  values.price = field(form, "Lot price (NX)", 100, [1, MARKET_LIMITS.price]);
  if (wanted) return values;
  const label = document.createElement("label");
  label.textContent = "Listing type ";
  values.mode = document.createElement("select");
  values.mode.setAttribute("aria-label", "Listing type");
  for (const [value, text] of [
    ["sale", "Fixed price"],
    ["auction", "Auction"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    values.mode.append(option);
  }
  label.append(values.mode);
  form.append(label);
  values.hours = field(form, "Duration (hours)", 168, [24, 168]);
  values.buyNow = field(form, "Auction buy now (0 = none)", 0, [
    0,
    MARKET_LIMITS.price,
  ]);
  return values;
}

function wantedItem(form, items) {
  const search = document.createElement("input");
  search.type = "search";
  search.maxLength = 64;
  search.placeholder = "Find an item by name";
  search.setAttribute("aria-label", "Find wanted item");
  const select = document.createElement("select");
  select.required = true;
  select.setAttribute("aria-label", "Wanted item");
  select.style.cssText = "display:block;width:100%;margin:8px 0";
  const templates = Object.values(items);
  if (templates.length > 20000) {
    throw new Error("MTS item catalog capacity exceeded");
  }
  const update = () => {
    const query = search.value.trim().toLocaleLowerCase("en-US");
    select.replaceChildren();
    for (const item of templates) {
      if (
        item.id >= 5000000 ||
        !item.name?.toLocaleLowerCase("en-US").includes(query)
      ) {
        continue;
      }
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = item.name;
      select.append(option);
      if (select.options.length === 30) break;
    }
  };
  search.value = "Red Potion";
  search.addEventListener("input", update);
  update();
  form.append(search, select);
  return select;
}

function formRequest(values, item, wanted) {
  const request = {
    kind: wanted ? "mts.want" : "mts.list",
    quantity: Number(values.quantity.value),
    price: Number(values.price.value),
  };
  if (wanted) return { ...request, itemId: Number(values.item.value) };
  return {
    ...request,
    uid: item.uid,
    mode: values.mode.value,
    hours: Number(values.hours.value),
    buyNow: Number(values.buyNow.value),
  };
}

export function closeMarketForm(panel) {
  panel.marketForm?.remove();
  panel.marketForm = null;
}
