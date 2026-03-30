const { createBrowser } = require("../lib/browser");
const { login } = require("../lib/login");
const { screenshot } = require("../lib/screenshot");

async function navigateToTransferencias(page, debug) {
  console.log("6. Navigating to Transferencias Express...");

  const sidebarLink = page.locator('a:has-text("Transferencia Express")').first();
  await sidebarLink.waitFor({ timeout: 10000 });
  await sidebarLink.click();
  await page.waitForTimeout(3000);
  await screenshot(page, "05a-nav-click", debug);

  const expressTab = page.locator('a').filter({ hasText: /^Express$/ }).first();
  if (await expressTab.isVisible().catch(() => false)) {
    await expressTab.click();
    await page.waitForTimeout(2000);
    await screenshot(page, "05b-express-tab", debug);
  }

  await page.waitForSelector('#tipoOperacion, #destinatario, [name="tipoOperacion"]', { timeout: 10000 });
  await screenshot(page, "06-transferencias-express", debug);
  console.log("   On Transferencias Express page.");
}

async function selectSourceAccount(page, fromFilter, debug) {
  // Try to set "Tipo de Operación" to TRANSFERENCIA if needed
  const tipoSelect = page.locator('.ui-select-container').nth(0);
  const tipoMatch = await tipoSelect.locator('.ui-select-match, [class*="match"]').first();
  const tipoText = await tipoMatch.textContent().catch(() => '');

  if (!/TRANSFERENCIA/i.test(tipoText)) {
    console.log("6a. Selecting Tipo de Operación: TRANSFERENCIA...");
    await tipoSelect.click();
    await page.waitForTimeout(1000);
    // Try clicking any visible option with TRANSFERENCIA
    const transferOption = page.locator('text=TRANSFERENCIA').first();
    const found = await transferOption.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    if (found) {
      await transferOption.click();
      await page.waitForTimeout(1500);
    } else {
      // Close dropdown and continue — it may already be set
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  }

  console.log("6b. Selecting source account (Cuenta de Origen)...");
  if (fromFilter) console.log(`   Filter: "${fromFilter}"`);

  await page.waitForFunction(
    () => {
      const el = document.querySelector('#cuenta');
      return el && !el.hasAttribute('disabled');
    },
    { timeout: 10000 }
  );

  const cuentaSelect = page.locator('.ui-select-container').nth(1);
  await cuentaSelect.click();
  await page.waitForTimeout(1000);

  const searchInput = cuentaSelect.locator('input.ui-select-search');
  if (fromFilter && await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill(fromFilter);
    await page.waitForTimeout(1000);
  }

  const options = page.locator('.ui-select-choices-row, [role="option"]');
  const count = await options.count();

  if (count === 0) {
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
  await screenshot(page, "06c-account-selected", debug);
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
  console.log(`   Available ${label}s:`);
  for (let i = 0; i < count; i++) {
    const text = await options.nth(i).textContent();
    console.log(`     ${i + 1}. ${text.trim().substring(0, 100)}`);
  }
  throw new Error(`No ${label} matching "${filter}" found. See options above.`);
}

async function selectBeneficiary(page, beneficiaryName, accountFilter, debug) {
  console.log(`7. Selecting beneficiary: "${beneficiaryName}"...`);
  if (accountFilter) console.log(`   Account filter: "${accountFilter}"`);

  const benefSelect = page.locator('.ui-select-container').nth(2);
  await benefSelect.click();
  await page.waitForTimeout(1000);
  await screenshot(page, "07a-beneficiary-clicked", debug);

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
  await screenshot(page, "07b-beneficiary-typed", debug);

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
  await screenshot(page, "07-beneficiary-selected", debug);
}

async function enterAmount(page, amount, debug) {
  console.log(`8. Entering amount: $${Number(amount).toLocaleString("es-CL")}...`);

  const amountInput = page.locator('input#monto');
  await amountInput.waitFor({ state: "attached", timeout: 10000 });

  await page.waitForFunction(
    () => !document.querySelector('input#monto').disabled,
    { timeout: 10000 }
  );

  await amountInput.click();
  await amountInput.fill(String(amount));
  await screenshot(page, "08-amount-entered", debug);
}

async function enterMessage(page, message, debug) {
  if (!message) return;
  console.log(`9. Entering message: "${message}"...`);

  const msgInput = await page.$(
    'input[name*="mensaje"], input[name*="glosa"], input[name*="message"], textarea[name*="mensaje"], input:near(:text("Mensaje")), input:near(:text("Glosa"))'
  );

  if (msgInput) {
    await msgInput.click();
    await msgInput.fill(message);
    await screenshot(page, "09-message-entered", debug);
  } else {
    console.log("   No message field found, skipping.");
  }
}

async function confirmTransfer(page, debug) {
  console.log("10. Selecting Mi Pass authorization and submitting...");

  const miPassOption = page.locator(
    ':text("Mi Pass"), label:has-text("Mi Pass"), [class*="mi-pass"], input[value*="mipass"]'
  ).first();

  if (await miPassOption.isVisible().catch(() => false)) {
    await miPassOption.click();
    console.log("   Selected Mi Pass.");
    await page.waitForTimeout(1000);
  }

  await screenshot(page, "10-mipass-selected", debug);

  const confirmBtn = page.locator(
    'button:has-text("Transferir"), button:has-text("Continuar"), button:has-text("Enviar"), button:has-text("Confirmar"), button[type="submit"]'
  ).first();

  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
    console.log("   Clicked submit.");
  } else {
    console.log("   No separate submit button found, Mi Pass may trigger directly.");
  }

  await page.waitForTimeout(3000);
  await screenshot(page, "11-submitted", debug);
}

async function waitForMiPass(page, debug) {
  console.log("\n==========================================");
  console.log("  MI PASS AUTHORIZATION REQUIRED");
  console.log("  Please approve on your Mi Pass app.");
  console.log("==========================================\n");

  const startTime = Date.now();
  const timeout = 180000;

  while (Date.now() - startTime < timeout) {
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
      const body = document.body.innerText;
      if (/comprobante\s+de\s+transferencia/i.test(body)) return { status: "success" };
      if (/transferencia\s+(exitosa|realizada|aprobada)/i.test(body)) return { status: "success" };
      if (/operaci[oó]n\s+express/i.test(body) && /datos\s+de\s+la\s+operaci[oó]n/i.test(body)) return { status: "success" };
      if (/transferencia\s+(rechazada|fallida)/i.test(body)) return { status: "error", text: body.substring(0, 200) };
      return null;
    });

    if (result?.status === "success") {
      console.log("   Mi Pass authorization successful!");
      await screenshot(page, "12-transfer-success", debug);
      return true;
    }

    if (result?.status === "error") {
      throw new Error(`Transfer failed: ${result.text}`);
    }

    process.stdout.write(".");
  }

  throw new Error("Mi Pass authorization timed out after 3 minutes");
}

module.exports = function (program) {
  program
    .command("transfer")
    .description("Send an express transfer")
    .requiredOption("--to <beneficiary>", "Beneficiary name (as saved in bank)")
    .requiredOption("--amount <amount>", "Transfer amount in CLP")
    .option("--from <from>", "Source account number or alias")
    .option("--account <account>", "Beneficiary account filter (for multi-account contacts)")
    .option("--message <message>", "Transfer message/description", "")
    .option("--headless", "Run in headless mode", false)
    .option("--debug", "Take screenshots at each step", false)
    .action(async (opts) => {
      console.log(`\nBanconexion Transfer`);
      console.log(`  To: ${opts.to}`);
      console.log(`  Amount: $${Number(opts.amount).toLocaleString("es-CL")}`);
      if (opts.from) console.log(`  From: ${opts.from}`);
      if (opts.account) console.log(`  Account: ${opts.account}`);
      if (opts.message) console.log(`  Message: ${opts.message}`);
      console.log("");

      const { browser, page } = await createBrowser(opts);

      try {
        await login(page, opts);
        await navigateToTransferencias(page, opts.debug);
        await selectSourceAccount(page, opts.from, opts.debug);
        await selectBeneficiary(page, opts.to, opts.account, opts.debug);
        await enterAmount(page, opts.amount, opts.debug);
        await enterMessage(page, opts.message, opts.debug);
        await confirmTransfer(page, opts.debug);
        await waitForMiPass(page, opts.debug);

        console.log("\nTransfer completed successfully!");
      } catch (err) {
        console.error(`\nError: ${err.message}`);
        await page.screenshot({ path: "debug-error.png", fullPage: true });
        console.error("Screenshot saved to debug-error.png");
        process.exit(1);
      } finally {
        await browser.close();
      }
    });
};
