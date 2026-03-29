#!/usr/bin/env node

const { chromium } = require("playwright");
const { program } = require("commander");
require("dotenv").config();

const LOGIN_URL =
  "https://login.portalempresas.bancochile.cl/bancochile-web/empresa/login/index.html#/login";

program
  .requiredOption("--to <beneficiary>", "Beneficiary name (as saved in bank)")
  .requiredOption("--amount <amount>", "Transfer amount in CLP")
  .option("--from <from>", "Source account number or alias")
  .option("--account <account>", "Beneficiary account number or bank name (for beneficiaries with multiple accounts)")
  .option("--message <message>", "Transfer message/description", "")
  .option("--headless", "Run in headless mode (no browser window)", false)
  .option("--debug", "Take screenshots at each step", false)
  .parse();

const opts = program.opts();

async function screenshot(page, name) {
  if (opts.debug) {
    await page.screenshot({ path: `debug-${name}.png`, fullPage: true });
    console.log(`  📸 Screenshot saved: debug-${name}.png`);
  }
}

async function login(page) {
  console.log("1. Navigating to login page...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle" });
  await screenshot(page, "01-login-page");

  // Wait for the login form to render (Angular SPA)
  console.log("2. Waiting for login form...");
  await page.getByLabel("RUT").waitFor({ timeout: 15000 });
  await screenshot(page, "02-login-form-loaded");

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

  await screenshot(page, "03-credentials-filled");

  // Click login button
  console.log("4. Clicking login...");
  await page.getByRole("button", { name: /ingresar/i }).click();

  // Wait for navigation after login
  console.log("5. Waiting for dashboard...");
  await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await screenshot(page, "04-dashboard");
  console.log("   Logged in successfully.");
}

async function navigateToTransferencias(page) {
  console.log("6. Navigating to Transferencias Express...");

  // Click the sidebar link — "Transferencia Express" (no trailing 's')
  const sidebarLink = page.locator('a:has-text("Transferencia Express")').first();
  await sidebarLink.waitFor({ timeout: 10000 });
  await sidebarLink.click();
  await page.waitForTimeout(3000);
  await screenshot(page, "05a-nav-click");

  // If we landed on a Transferencias page with tabs, click the "Express" tab
  const expressTab = page.locator('a').filter({ hasText: /^Express$/ }).first();
  if (await expressTab.isVisible().catch(() => false)) {
    await expressTab.click();
    await page.waitForTimeout(2000);
    await screenshot(page, "05b-express-tab");
  }

  // Verify we're on the right page by checking for the form
  await page.waitForSelector('#tipoOperacion, #destinatario, [name="tipoOperacion"]', { timeout: 10000 });
  await screenshot(page, "06-transferencias-express");
  console.log("   On Transferencias Express page.");
}

async function selectSourceAccount(page, fromFilter) {
  // Ensure "Tipo de Operación" is set to TRANSFERENCIA
  const tipoSelect = page.locator('.ui-select-container').nth(0);
  const tipoText = await tipoSelect.textContent();
  if (/seleccione/i.test(tipoText)) {
    console.log("6a. Selecting Tipo de Operación: TRANSFERENCIA...");
    await tipoSelect.click();
    await page.waitForTimeout(500);
    const transferOption = page.locator('.ui-select-choices-row:has-text("TRANSFERENCIA")').first();
    await transferOption.click();
    await page.waitForTimeout(1500);
  }

  console.log("6b. Selecting source account (Cuenta de Origen)...");
  if (fromFilter) console.log(`   Filter: "${fromFilter}"`);

  // Wait for Cuenta de Origen to be enabled
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#cuenta');
      return el && !el.hasAttribute('disabled');
    },
    { timeout: 10000 }
  );

  // Cuenta de Origen is the 2nd ui-select (index 1)
  const cuentaSelect = page.locator('.ui-select-container').nth(1);
  await cuentaSelect.click();
  await page.waitForTimeout(1000);

  // If search is enabled, type the filter
  const searchInput = cuentaSelect.locator('input.ui-select-search');
  if (fromFilter && await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill(fromFilter);
    await page.waitForTimeout(1000);
  }

  // Get all available options
  const options = page.locator('.ui-select-choices-row, [role="option"]');
  const count = await options.count();

  if (count === 0) {
    // Try append-to-body dropdown
    const bodyOptions = page.locator('.ui-select-choices-content .ui-select-choices-row');
    const bodyCount = await bodyOptions.count();
    if (bodyCount === 0) throw new Error("Could not find any source account options");

    if (!fromFilter) {
      await bodyOptions.first().click();
      console.log("   Selected first available account.");
    } else {
      await selectMatchingOption(bodyOptions, bodyCount, fromFilter, "source account");
    }
  } else if (!fromFilter) {
    await options.first().click();
    console.log("   Selected first available account.");
  } else {
    await selectMatchingOption(options, count, fromFilter, "source account");
  }

  await page.waitForTimeout(1500);
  await screenshot(page, "06c-account-selected");
}

async function selectMatchingOption(options, count, filter, label) {
  for (let i = 0; i < count; i++) {
    const text = await options.nth(i).textContent();
    if (text.toLowerCase().includes(filter.toLowerCase())) {
      await options.nth(i).click();
      console.log(`   Selected ${label}: "${text.trim().substring(0, 80)}"`);
      return;
    }
  }
  // No match — list available options
  console.log(`   Available ${label}s:`);
  for (let i = 0; i < count; i++) {
    const text = await options.nth(i).textContent();
    console.log(`     ${i + 1}. ${text.trim().substring(0, 100)}`);
  }
  throw new Error(`No ${label} matching "${filter}" found. See options above.`);
}

async function selectBeneficiary(page, beneficiaryName, accountFilter) {
  console.log(`7. Selecting beneficiary: "${beneficiaryName}"...`);
  if (accountFilter) console.log(`   Account filter: "${accountFilter}"`);

  // The beneficiary is the 3rd ui-select (index 2: after tipo operacion and cuenta origen)
  const uiSelects = page.locator('.ui-select-container');

  // Find the one related to beneficiary (index 2, 0-based)
  const benefSelect = uiSelects.nth(2);
  await benefSelect.click();
  await page.waitForTimeout(1000);
  await screenshot(page, "07a-beneficiary-clicked");

  // Now try to type — the search input inside this container should be visible
  const searchInput = benefSelect.locator('input.ui-select-search');
  const isVisible = await searchInput.isVisible().catch(() => false);

  if (isVisible) {
    console.log("   Search input visible, typing...");
    await searchInput.fill(beneficiaryName);
  } else {
    console.log("   Search input hidden, using keyboard...");
    await page.keyboard.type(beneficiaryName, { delay: 50 });
  }
  await page.waitForTimeout(2000);
  await screenshot(page, "07b-beneficiary-typed");

  // Get all matching suggestions
  const suggestions = page.locator(
    `[role="option"]:has-text("${beneficiaryName}"), .ui-select-choices-row:has-text("${beneficiaryName}")`
  );
  const count = await suggestions.count();

  if (count === 0) {
    console.log("   No dropdown suggestion found, pressing Enter...");
    await page.keyboard.press("Enter");
  } else if (count === 1 || !accountFilter) {
    await suggestions.first().click();
    console.log(`   Selected beneficiary from dropdown (${count} option(s)).`);
  } else {
    // Multiple accounts — filter by account number or bank name
    console.log(`   Found ${count} accounts, filtering by "${accountFilter}"...`);
    let matched = false;
    for (let i = 0; i < count; i++) {
      const text = await suggestions.nth(i).textContent();
      if (text.toLowerCase().includes(accountFilter.toLowerCase())) {
        await suggestions.nth(i).click();
        console.log(`   Selected account: "${text.trim().substring(0, 80)}"`);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Log available options and fall back to first
      console.log("   Available accounts:");
      for (let i = 0; i < count; i++) {
        const text = await suggestions.nth(i).textContent();
        console.log(`     ${i + 1}. ${text.trim().substring(0, 100)}`);
      }
      throw new Error(
        `No account matching "${accountFilter}" found for beneficiary "${beneficiaryName}". See options above.`
      );
    }
  }

  await page.waitForTimeout(1000);
  await screenshot(page, "07-beneficiary-selected");
}

async function enterAmount(page, amount) {
  console.log(`8. Entering amount: $${Number(amount).toLocaleString("es-CL")}...`);

  const amountInput = page.locator('input#monto');
  await amountInput.waitFor({ state: "attached", timeout: 10000 });

  // The field may be disabled briefly after beneficiary selection
  await page.waitForFunction(
    () => !document.querySelector('input#monto').disabled,
    { timeout: 10000 }
  );

  await amountInput.click();
  await amountInput.fill(String(amount));

  await screenshot(page, "08-amount-entered");
}

async function enterMessage(page, message) {
  if (!message) return;
  console.log(`9. Entering message: "${message}"...`);

  const msgInput = await page.$(
    'input[name*="mensaje"], input[name*="glosa"], input[name*="message"], textarea[name*="mensaje"], input:near(:text("Mensaje")), input:near(:text("Glosa"))'
  );

  if (msgInput) {
    await msgInput.click();
    await msgInput.fill(message);
    await screenshot(page, "09-message-entered");
  } else {
    console.log("   No message field found, skipping.");
  }
}

async function confirmTransfer(page) {
  console.log("10. Selecting Mi Pass authorization and submitting...");

  // Click the "Mi Pass" authorization option
  const miPassOption = page.locator(
    ':text("Mi Pass"), label:has-text("Mi Pass"), [class*="mi-pass"], input[value*="mipass"]'
  ).first();

  if (await miPassOption.isVisible().catch(() => false)) {
    await miPassOption.click();
    console.log("   Selected Mi Pass.");
    await page.waitForTimeout(1000);
  }

  await screenshot(page, "10-mipass-selected");

  // Now look for a submit/transfer/confirm button
  const confirmBtn = page.locator(
    'button:has-text("Transferir"), button:has-text("Continuar"), button:has-text("Enviar"), button:has-text("Confirmar"), button[type="submit"]'
  ).first();

  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
    console.log("   Clicked submit.");
  } else {
    // Maybe clicking Mi Pass already triggers the flow
    console.log("   No separate submit button found, Mi Pass may trigger directly.");
  }

  await page.waitForTimeout(3000);
  await screenshot(page, "11-submitted");
}

async function waitForMiPass(page) {
  console.log("\n==========================================");
  console.log("  MI PASS AUTHORIZATION REQUIRED");
  console.log("  Please approve on your Mi Pass app.");
  console.log("==========================================\n");

  // Wait for the Mi Pass screen to appear, then wait for it to resolve
  // Poll for up to 120 seconds for the authorization to complete
  const startTime = Date.now();
  const timeout = 180000;

  while (Date.now() - startTime < timeout) {
    await page.waitForTimeout(3000);

    // Check for success — look for visible elements with transfer-complete language
    // Use page.evaluate to only match visible elements and avoid false positives
    const result = await page.evaluate(() => {
      const body = document.body.innerText;
      // "Comprobante de Transferencia" or "Transferencia exitosa/realizada" indicate completion
      if (/comprobante\s+de\s+transferencia/i.test(body)) return { status: "success" };
      if (/transferencia\s+(exitosa|realizada|aprobada)/i.test(body)) return { status: "success" };
      if (/operaci[oó]n\s+express/i.test(body) && /datos\s+de\s+la\s+operaci[oó]n/i.test(body)) return { status: "success" };
      if (/transferencia\s+(rechazada|fallida)/i.test(body)) return { status: "error", text: body.substring(0, 200) };
      return null;
    });

    if (result?.status === "success") {
      console.log("   Mi Pass authorization successful!");
      await screenshot(page, "12-transfer-success");
      return true;
    }

    if (result?.status === "error") {
      throw new Error(`Transfer failed: ${result.text}`);
    }

    process.stdout.write(".");
  }

  throw new Error("Mi Pass authorization timed out after 3 minutes");
}

async function main() {
  console.log(`\nBanconexion Transfer`);
  console.log(`  To: ${opts.to}`);
  console.log(`  Amount: $${Number(opts.amount).toLocaleString("es-CL")}`);
  if (opts.from) console.log(`  From: ${opts.from}`);
  if (opts.account) console.log(`  Account: ${opts.account}`);
  if (opts.message) console.log(`  Message: ${opts.message}`);
  console.log("");

  const browser = await chromium.launch({
    headless: opts.headless,
    slowMo: 100,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "es-CL",
  });

  const page = await context.newPage();

  try {
    await login(page);
    await navigateToTransferencias(page);
    await selectSourceAccount(page, opts.from);
    await selectBeneficiary(page, opts.to, opts.account);
    await enterAmount(page, opts.amount);
    await enterMessage(page, opts.message);
    await confirmTransfer(page);
    await waitForMiPass(page);

    console.log("\nTransfer completed successfully!");
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    await page.screenshot({ path: "debug-error.png", fullPage: true });
    console.error("Screenshot saved to debug-error.png");
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
