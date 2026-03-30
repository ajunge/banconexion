const { chromium } = require("playwright");

async function createBrowser({ headless = false } = {}) {
  const browser = await chromium.launch({
    headless,
    slowMo: 100,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "es-CL",
  });

  const page = await context.newPage();
  return { browser, context, page };
}

module.exports = { createBrowser };
