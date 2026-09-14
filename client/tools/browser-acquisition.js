import puppeteer from "puppeteer-core";

const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Borrow an explicit browser or launch one isolated browser for an online check. */
export async function acquireBrowser(options = {}) {
  if (options.browser) {
    return { browser: options.browser, ownership: "borrowed-object" };
  }
  if (options.browserWSEndpoint) {
    return {
      browser: await puppeteer.connect({
        browserWSEndpoint: options.browserWSEndpoint,
      }),
      ownership: "borrowed-connection",
    };
  }
  return {
    browser: await puppeteer.launch({
      executablePath: options.chrome ?? DEFAULT_CHROME,
      headless: !options.headed,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    }),
    ownership: "owned",
  };
}
