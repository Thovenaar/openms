import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, closeConsole } from "./online-ui-repairs.js";

/** Native inputs; bounded frame observations never pause or step the presentation. */
export async function runOnlineLoginPages({
  browser,
  url,
  output,
  scope = "pages",
}) {
  assertion(
    ["pages", "controls", "utilities"].includes(scope),
    "Invalid login check scope",
  );
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    errors: [],
    results: [],
    traces: [],
    controls: [],
  };
  const contexts = [],
    pages = [];
  const identityOptions = { development: scope !== "utilities" };
  try {
    report.identity = await onlineIdentity(url, [], identityOptions);
    for (const width of [1280, 800]) {
      const page = await participant(browser, contexts, pages, report);
      await page.setViewport({ width, height: width === 800 ? 600 : 800 });
      await measureStage(report.timings, `pages-${width}`, () => {
        const options = { url, output, width, report };
        if (scope === "utilities") return inspectUtilities(page, options);
        if (scope === "controls") return inspectControls(page, options);
        return inspectPages(page, options);
      });
    }
    assertion(report.errors.length === 0, "Browser errors", report.errors);
    assertion(
      (await onlineIdentity(url, [], identityOptions)).sourceBuildId ===
        report.identity.sourceBuildId,
      "Source changed during check",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(output, `failure-${index}.png`) });
    }
  } finally {
    await measureStage(report.timings, "teardown", async () => {
      for (const context of contexts) await context.close();
    });
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

/** Production account utilities remain visible and operable without inspection chrome. */
async function inspectUtilities(page, { url, output, width, report }) {
  await page.goto(url);
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  assertion(!(await page.$("#console-toggle")), "Expected production shell");
  await page.type('[name="name"]', "loginpages");
  await page.type('[name="password"]', "password");
  await page.click(".online-login-submit");
  await page.waitForFunction(() => {
    const login = window.maple.snapshot().login;
    return (
      login.stage === "characters" &&
      !login.transition.active &&
      login.portraits === 1
    );
  });
  const bounds = await page.evaluate(utilityGeometry);
  report.controls.push({ width, ...bounds });
  assertion(
    bounds.visible && bounds.separated && bounds.framed,
    "Account utilities overlap, are clipped or lack button chrome",
    { actual: bounds },
  );
  assertion(
    (await page.evaluate(() => window.maple.snapshot().sourceBuildId)) ===
      report.identity.sourceBuildId,
    "Browser source identity mismatch",
  );
  await operateUtilities(page, { output, width });
  assertion(
    !(await page.$eval("#error", (node) => node.value)),
    "Error journal is not empty",
  );
}

/** Refresh through a native click, then sign out through the keyboard tab order. */
async function operateUtilities(page, { output, width }) {
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/characters") &&
      response.request().method() === "GET",
  );
  await page.click(".online-login-refresh");
  assertion((await refreshed).ok(), "Refresh request failed");
  await page.waitForFunction(
    () =>
      document.querySelector(".online-login").getAttribute("aria-busy") ===
      "false",
  );
  assertion(
    (await page.evaluate(() => window.maple.snapshot().login)).stage ===
      "characters",
    "Refresh left character selection",
  );
  await focusSignOut(page);
  await page.screenshot({ path: join(output, `utilities-${width}.png`) });
  const signedOut = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/session") &&
      response.request().method() === "DELETE",
  );
  await page.keyboard.press("Enter");
  assertion((await signedOut).ok(), "Sign out request failed");
  await page.waitForFunction(
    () =>
      window.maple.snapshot().login.stage === "account" &&
      !window.maple.snapshot().login.transition.active,
  );
  assertion(
    await page.$eval(".online-login-characters", (node) => node.hidden),
    "Account utilities remain visible after sign out",
  );
}

async function focusSignOut(page) {
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    if (
      await page.$eval(
        ".online-login-signout",
        (node) => node === document.activeElement,
      )
    ) {
      return;
    }
  }
  throw new Error("Sign out is not reachable after Refresh by keyboard");
}

/** Read rendered hit targets and chrome, including the authored selection buttons. */
function utilityGeometry() {
  const buttons = ["refresh", "signout", "enter", "new", "delete"].map(
    (name) => {
      const node = document.querySelector(`.online-login-${name}`);
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        name,
        ...rect.toJSON(),
        background: style.backgroundColor,
        border: style.borderTopWidth,
        shadow: style.boxShadow,
        enabled: !node.disabled,
        hit:
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ) === node,
      };
    },
  );
  const utilities = buttons.slice(0, 2);
  return {
    buttons,
    visible: utilities.every(
      (button) =>
        button.enabled &&
        button.hit &&
        button.width >= 80 &&
        button.height >= 24 &&
        button.left >= 0 &&
        button.right <= innerWidth &&
        button.top >= 0 &&
        button.bottom <= innerHeight,
    ),
    separated: utilities.every((button) =>
      buttons.every(
        (other) =>
          button === other ||
          button.right <= other.left ||
          button.left >= other.right ||
          button.bottom <= other.top ||
          button.top >= other.bottom,
      ),
    ),
    framed: utilities.every(
      (button) =>
        button.background !== "rgba(0, 0, 0, 0)" &&
        button.border !== "0px" &&
        button.shadow !== "none",
    ),
  };
}

async function inspectControls(page, options) {
  const { url, output, width, report } = options;
  await page.goto(url);
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  await closeConsole(page);
  await recoveryButtons(page, options);
  await page.type('[name="name"]', "loginpages");
  await page.type('[name="password"]', "password");
  await page.click(".online-login-submit");
  await page.waitForFunction(() => {
    const state = window.maple.snapshot().login;
    return (
      state.stage === "characters" &&
      !state.transition.active &&
      state.portraits === 3
    );
  });
  for (let index = 0; index < 3; index++) {
    await (await page.$$(".online-login-card"))[index].click();
    const names = await page.evaluate(nameGeometry);
    report.controls.push({ width, selected: index, names });
    for (const name of names) {
      assertion(
        Number.isInteger(name.localLeft) && name.transform === "none",
        "Character name has a fractional origin",
        name,
      );
      assertion(
        Math.abs(name.textLeft - name.expectedLeft) < 0.05 && name.top === 372,
        "Character text does not share native nameplate coordinates",
        name,
      );
    }
    await page.screenshot({
      path: join(output, `names-${width}-${index}.png`),
    });
  }
  assertion(
    (await page.evaluate(() => window.maple.snapshot().sourceBuildId)) ===
      report.identity.sourceBuildId,
    "Browser source identity mismatch",
  );
  assertion(
    !(await page.$eval("#error", (node) => node.value)),
    "Error journal is not empty",
  );
  await page.click("#console-toggle");
  await page.click(".online-login-signout");
  await page.waitForFunction(
    () => window.maple.snapshot().login.stage === "account",
  );
}

async function recoveryButtons(page, { output, width, report }) {
  for (const [label, x, y, size] of [
    ["Find login ID", 554, 301, 82],
    ["Find password", 636, 302, 66],
  ]) {
    const button = `button[title="${label}"]`;
    const bounds = await page.$eval(button, (node) => ({
      x: node.offsetLeft,
      y: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
      canvases: node.querySelectorAll("canvas:not([hidden])").length,
      asset: node.querySelector("section")?.getAttribute("aria-label"),
    }));
    report.controls.push({ viewportWidth: width, label, ...bounds });
    assertion(
      bounds.x === x &&
        bounds.y === y &&
        bounds.width === size &&
        bounds.height === 23 &&
        bounds.canvases === 1,
      "Recovery button artwork or placement is missing",
      bounds,
    );
    await page.hover(button);
    await page.screenshot({
      path: join(output, `recovery-${width}-${size}.png`),
    });
    await page.click(button);
    await page.waitForSelector('[aria-label="Recover your account"]', {
      visible: true,
    });
    assertion(
      await page.$eval(".online-login-window", (node) => node.inert),
      "Recovery did not block background controls",
    );
    await page.type(
      '[aria-label="Recovery email address"]',
      "player@example.invalid",
    );
    await page.keyboard.press("Escape");
    await page.waitForSelector('[aria-label="Recover your account"]', {
      hidden: true,
    });
    assertion(
      await page.$eval(button, (node) => node === document.activeElement),
      "Recovery did not restore button focus",
    );
  }
}

function nameGeometry() {
  const book = document
    .querySelector(".online-login-window")
    .getBoundingClientRect();
  const scale = book.width / 800;
  return [...document.querySelectorAll(".online-login-character-name")].map(
    (name, index) => {
      const style = getComputedStyle(name),
        bounds = name.getBoundingClientRect();
      const width = Math.min(
        216,
        name.clientWidth < 41 ? 58 : name.clientWidth + 18,
      );
      // Native00607258 centers the plate at286+125*i;00605ea2 biases text by-1.
      const plateLeft = 286 + 125 * index - Math.trunc(width / 2);
      return {
        name: name.textContent,
        width: name.clientWidth,
        localLeft: parseFloat(style.left),
        transform: style.transform,
        textLeft: (bounds.left - book.left) / scale,
        top: Math.round((bounds.top - book.top) / scale),
        expectedLeft:
          plateLeft + Math.trunc((width - name.clientWidth) / 2) - 1,
      };
    },
  );
}

async function inspectPages(page, options) {
  const { url, output, width, report } = options;
  await page.goto(url);
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  await closeConsole(page);
  await page.type('[name="name"]', "loginpages");
  await page.type('[name="password"]', "password");
  await transition(page, ".online-login-submit", "characters", options);
  await page.waitForFunction(
    () => window.maple.snapshot().login.portraits === 3,
  );
  await arrows(page);
  await page.screenshot({ path: join(output, `selection-${width}.png`) });
  await page.click(".online-login-next");
  await page.waitForFunction(() => window.maple.snapshot().login.page === 1);
  await page.click(".online-login-previous");
  await page.waitForFunction(() => window.maple.snapshot().login.page === 0);
  await transition(page, ".online-login-new", "create", options);
  await transition(page, ".online-login-back", "characters", options);
  assertion(
    (await page.evaluate(() => window.maple.snapshot().sourceBuildId)) ===
      report.identity.sourceBuildId,
    "Browser source identity mismatch",
  );
  assertion(
    !(await page.$eval("#error", (node) => node.value)),
    "Error journal is not empty",
  );
  await page.click("#console-toggle");
  await page.click(".online-login-signout");
  await page.waitForFunction(
    () => window.maple.snapshot().login.stage === "account",
  );
}

async function arrows(page) {
  const positions = await page.evaluate(() => {
    const book = document
      .querySelector(".online-login-window")
      .getBoundingClientRect();
    const scale = book.width / 800;
    return ["previous", "next"].map((side) => {
      const rect = document
        .querySelector(`.online-login-${side}`)
        .getBoundingClientRect();
      return {
        x: (rect.left - book.left) / scale,
        y: (rect.top - book.top) / scale,
      };
    });
  });
  for (const [index, expected] of [
    [140, 293],
    [588, 295],
  ].entries()) {
    assertion(
      Math.abs(positions[index].x - expected[0]) < 0.1 &&
        Math.abs(positions[index].y - expected[1]) < 0.1,
      "Page arrow does not match native layer coordinates",
      positions,
    );
  }
}

async function transition(page, selector, destination, options) {
  await page.evaluate(observeTransition);
  await page.click(selector);
  await page.waitForFunction(() => window.loginPageTrace.frames.length > 0);
  for (let index = 0; index < 3; index++) {
    await page.screenshot({
      path: join(
        options.output,
        `${options.width}-${destination}-${options.report.traces.length}-${index}.png`,
      ),
    });
  }
  await page.waitForFunction(
    (name) =>
      window.maple.snapshot().login.stage === name &&
      !window.maple.snapshot().login.transition.active,
    {},
    destination,
  );
  await page.waitForFunction(() => window.loginPageTrace.done);
  const trace = await page.evaluate(() => window.loginPageTrace);
  options.report.traces.push({ width: options.width, destination, ...trace });
  assertion(
    trace.frames.length > 2 && !trace.failure,
    "Invalid transition trace",
    trace,
  );
  let previous = 600;
  for (const frame of trace.frames) {
    const direction = Math.sign(frame.fromY - frame.toY);
    const remaining = Math.abs(frame.toY);
    assertion(
      remaining <= previous && remaining <= 600,
      "Page reversed or overshot",
      frame,
    );
    assertion(
      Math.abs(frame.fromY - frame.toY) === 600,
      "Gap between pages",
      frame,
    );
    assertion(
      frame.fromY * direction >= 0 && frame.toY * direction <= 0,
      "Pages left viewport uncovered",
      frame,
    );
    assertion(
      frame.aligned && frame.visible && frame.inert && frame.clipped,
      "Page layers separated during transition",
      frame,
    );
    previous = remaining;
  }
}

function observeTransition() {
  const trace = { frames: [], done: false, failure: null };
  window.loginPageTrace = trace;
  const started = performance.now();
  const sample = () => {
    const state = window.maple.snapshot().login;
    if (!state.transition.active && trace.frames.length) {
      trace.done = true;
      return;
    }
    if (trace.frames.length >= 240 || performance.now() - started > 30000) {
      trace.failure = "Transition observation budget exhausted";
      trace.done = true;
      return;
    }
    if (state.transition.active) trace.frames.push(observePageFrame(state));
    requestAnimationFrame(sample);
  };
  // Browser-evaluated functions are self-contained; no runtime mutation or imports.
  function observePageFrame(state) {
    const read = (name) => {
      const controls = document.querySelector(`.online-login-${name}`);
      const artwork = document.querySelector(`[aria-label="Login ${name}"]`);
      return {
        controls,
        artwork,
        y: new DOMMatrix(getComputedStyle(controls).transform).m42,
      };
    };
    const from = read(state.transition.from),
      to = read(state.transition.to);
    const scenes = [...document.querySelectorAll(".online-login-scenery")];
    return {
      ms: state.transition.elapsedMs,
      camera: state.camera,
      fromY: from.y,
      toY: to.y,
      aligned:
        [from, to].every(
          ({ controls, artwork }) =>
            controls.style.transform === artwork.style.transform,
        ) &&
        scenes.every((scene) =>
          [from.y, to.y].includes(new DOMMatrix(scene.style.transform).m42),
        ),
      visible:
        !from.controls.hidden &&
        !to.controls.hidden &&
        !from.artwork.hidden &&
        !to.artwork.hidden &&
        scenes.every((scene) => !scene.hidden),
      inert: document.querySelector(".online-login-body").inert,
      clipped:
        getComputedStyle(document.querySelector(".online-login-window"))
          .overflow === "hidden",
    };
  }
  requestAnimationFrame(sample);
}
