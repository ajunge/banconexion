const { screenshot } = require("./screenshot");

const LOGIN_URL =
  "https://login.portalempresas.bancochile.cl/bancochile-web/empresa/login/index.html#/login";

async function login(page, { debug = false } = {}) {
  console.log("1. Navigating to login page...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await screenshot(page, "01-login-page", debug);

  console.log("2. Waiting for login form...");
  await page.getByLabel("RUT").waitFor({ timeout: 15000 });
  await screenshot(page, "02-login-form-loaded", debug);

  const username = process.env.BANCO_USERNAME;
  const password = process.env.BANCO_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "Missing BANCO_USERNAME or BANCO_PASSWORD in .env file"
    );
  }

  console.log("3. Entering credentials...");
  await page.getByLabel("RUT").fill(username);
  await page.locator('input[name="password"]').fill(password);
  await screenshot(page, "03-credentials-filled", debug);

  console.log("4. Clicking login...");
  await page.getByRole("button", { name: /ingresar/i }).click();

  console.log("5. Waiting for dashboard...");
  await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await screenshot(page, "04-dashboard", debug);
  console.log("   Logged in successfully.");
}

module.exports = { login };
