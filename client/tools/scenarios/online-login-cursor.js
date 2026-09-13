import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { closeConsole } from "./online-ui-repairs.js";

const CURSOR = '.online-login > [aria-label="Cursor"]';

/** Native pointer input across login surfaces and the field handoff, in one isolated context. */
export async function runOnlineLoginCursor({ browser, url, output }) {
  await mkdir(output, { recursive: true });
  const report = { status: "running", timings: {}, checks: [], errors: [] };
  const context = await browser.createBrowserContext();
  const page = await cursorPage(context, report);
  try {
    report.identity = await onlineIdentity(url);
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url);
    await page.bringToFront();
    await loginReady(page);
    await closeConsole(page);
    await measureStage(report.timings, "account-and-popups", () =>
      account(page, output),
    );
    report.checks.push(
      "Original idle, actionable and pressed cursor states render above login controls and popups",
    );
    await measureStage(report.timings, "selection-and-creation", () =>
      selection(page, output),
    );
    report.checks.push(
      "Cursor stays aligned at 1280×800 and 800×600 through selection and creation",
    );
    await measureStage(report.timings, "field-handoff-and-return", () =>
      handoff(page),
    );
    report.checks.push(
      "Field entry retires the login cursor; disconnect restores one login cursor",
    );
    assertion(report.errors.length === 0, "Unexpected browser errors", {
      actual: report.errors,
    });
    assertion(
      (await onlineIdentity(url)).sourceBuildId ===
        report.identity.sourceBuildId,
      "Source changed during cursor replay",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    report.observation = await page.evaluate(() => ({
      login: window.maple?.snapshot().login,
      focused: document.hasFocus(),
    }));
    await page.screenshot({ path: join(output, "failure.png") });
  } finally {
    await measureStage(report.timings, "teardown", () => context.close());
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function cursorPage(context, report) {
  const page = await context.newPage();
  const wire = await page.createCDPSession();
  await wire.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => {
    if (report.errors.length < 16) report.errors.push(error.message);
  });
  return page;
}

function loginReady(page) {
  return page.waitForFunction(
    () =>
      window.maple?.snapshot().login?.artwork &&
      window.maple.snapshot().login.cursor,
  );
}

async function pointer(page, selector, state = 4) {
  await page.hover(selector);
  await cursorState(page, state);
  const evidence = await page.$eval(CURSOR, (plane) => {
    const canvas = plane.querySelector("canvas");
    const box = canvas.getBoundingClientRect();
    const snapshot = window.maple.snapshot().login.cursor;
    const host = document
      .querySelector(".online-login")
      .getBoundingClientRect();
    const x = host.left + snapshot.x,
      y = host.top + snapshot.y;
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      painted: pixels.some((value, index) => index % 4 === 3 && value !== 0),
      nearPointer:
        x >= box.left - 32 &&
        x <= box.right + 32 &&
        y >= box.top - 32 &&
        y <= box.bottom + 32,
      osCursor: getComputedStyle(document.elementFromPoint(x, y)).cursor,
      transparentToInput: getComputedStyle(plane).pointerEvents === "none",
    };
  });
  assertion(
    evidence.painted &&
      evidence.nearPointer &&
      evidence.osCursor === "none" &&
      evidence.transparentToInput,
    "Cursor artwork, position and native-cursor suppression",
    { actual: evidence },
  );
}

function cursorState(page, state) {
  return page.waitForFunction(
    (expected) => {
      const cursor = window.maple.snapshot().login.cursor;
      return cursor?.visible && cursor.state === expected;
    },
    {},
    state,
  );
}

async function account(page, output) {
  await page.hover("#console-toggle");
  assertion(
    await page.$eval(
      "#console-toggle",
      (node) => getComputedStyle(node).cursor !== "none",
    ),
    "Inspection keeps its native cursor",
  );
  await pointer(page, '.online-login-account [name="name"]');
  await page.mouse.down();
  await cursorState(page, 12);
  await page.mouse.up();
  await cursorState(page, 4);
  const bounds = await page.$eval(".online-login", (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + 8, y: rect.top + 8 };
  });
  await page.mouse.move(bounds.x, bounds.y);
  await cursorState(page, 0);
  await pointer(page, ".online-login-recovery");
  await page.click(".online-login-recovery");
  await pointer(page, '[aria-label="Recovery email address"]');
  await page.screenshot({ path: join(output, "recovery-cursor.png") });
  await page.click('[aria-label="Close account recovery"]');
  await page.click(".online-login-register");
  await pointer(page, '[aria-label="Close registration"]');
  await page.click('[aria-label="Close registration"]');
  await pointer(page, '.online-login-account [name="name"]');
  await page.screenshot({ path: join(output, "account-cursor.png") });
}

async function selection(page, output) {
  await page.type('.online-login-account [name="name"]', "admin");
  await page.type('.online-login-account [name="password"]', "password");
  await page.click(".online-login-submit");
  await waitStage(page, "characters");
  await pointer(page, ".online-login-enter");
  await page.screenshot({ path: join(output, "selection-cursor.png") });
  await page.setViewport({ width: 800, height: 600 });
  await pointer(page, ".online-login-new");
  await page.click(".online-login-new");
  await waitStage(page, "create");
  await pointer(page, '[name="character"]');
  await page.type('[name="character"]', "CursorTest");
  await page.click(".online-login-create-submit");
  await page.waitForSelector('.online-login-create[data-phase="appearance"]');
  await pointer(page, ".online-login-create-submit");
  await page.screenshot({ path: join(output, "creation-cursor.png") });
  await page.click(".online-login-back");
  await page.click(".online-login-back");
  await waitStage(page, "characters");
}

function waitStage(page, stage) {
  return page.waitForFunction(
    (expected) => {
      const login = window.maple.snapshot().login;
      return login.stage === expected && !login.transition.active;
    },
    {},
    stage,
  );
}

async function handoff(page) {
  await page.click(".online-login-enter");
  await page.waitForFunction(
    () =>
      window.maple.snapshot().online.status === "active" &&
      !window.maple.snapshot().loading,
  );
  assertion(
    (await page.$(CURSOR)) === null,
    "Login cursor should retire at field entry",
  );
  await page.hover("#viewport > canvas");
  await page.waitForFunction(() => {
    const cursor = document.querySelector(
      '.maple-ui-root [aria-label="Cursor"]',
    );
    return (
      cursor &&
      !cursor.hidden &&
      document.querySelector("canvas.maple-original-cursor")
    );
  });
  // Revoke only this disposable fixture session to exercise the return presentation.
  await page.evaluate(async () => {
    const config = await (await fetch("/api/v1/config")).json();
    const response = await fetch("/api/v1/session", {
      method: "DELETE",
      headers: { "x-csrf-token": config.csrfToken },
    });
    if (!response.ok) {
      throw new Error(`Fixture sign-out HTTP ${response.status}`);
    }
  });
  await loginReady(page);
  await pointer(page, '.online-login-account [name="name"]');
  assertion(
    (await page.$$(CURSOR)).length === 1,
    "Return should install one cursor",
  );
  await page.goto("about:blank");
}
