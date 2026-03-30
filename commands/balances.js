const { createBrowser } = require("../lib/browser");
const { login } = require("../lib/login");
const { screenshot } = require("../lib/screenshot");

async function scrapeAccountBalances(page) {
  return await page.evaluate(() => {
    const results = [];
    const body = document.body.innerText;

    // Extract account number (e.g. "00-001-70743-06")
    const acctMatch = body.match(/Cuenta Corriente[\s\S]*?(\d{2}-\d{3}-\d{4,}-\d{2})/i);
    const account = acctMatch ? acctMatch[1] : null;

    // Extract saldo disponible
    const saldoMatch = body.match(/SALDO DISPONIBLE[\s\S]*?\$\s*([\d.,\-]+)/i);
    const saldo = saldoMatch ? saldoMatch[1].trim() : null;

    // Extract línea disponible
    const lineaMatch = body.match(/[Ll][ií]nea [Dd]isponible[\s\S]*?\$\s*([\d.,\-]+)/i);
    const linea = lineaMatch ? lineaMatch[1].trim() : null;

    if (account || saldo) {
      results.push({ account, saldoDisponible: saldo, lineaDisponible: linea });
    }

    return results;
  });
}

async function scrapeCreditCards(page, debug) {
  const cards = [];

  const visibleCards = await scrapeVisibleCards(page);
  cards.push(...visibleCards);
  const seenCards = new Set(visibleCards.map(c => c.name));

  // Check for carousel pagination ("X de Y") and click next to reveal more
  const paginationText = await page.evaluate(() => {
    const body = document.body.innerText;
    const match = body.match(/TARJETAS DE CR[ÉE]DITO\s+(\d+)\s+de\s+(\d+)/i);
    return match ? { visible: parseInt(match[1]), total: parseInt(match[2]) } : null;
  });

  if (paginationText && paginationText.total > seenCards.size) {
    const nextBtn = page.locator('[class*="tarjeta"] button, [class*="card"] button, [class*="carousel"] button, [class*="arrow"] button').last();

    for (let i = 0; i < paginationText.total; i++) {
      const clicked = await nextBtn.click().then(() => true).catch(() => false);
      if (!clicked) break;
      await page.waitForTimeout(1000);

      const moreCards = await scrapeVisibleCards(page);
      for (const card of moreCards) {
        if (!seenCards.has(card.name)) {
          seenCards.add(card.name);
          cards.push(card);
        }
      }
      await screenshot(page, `balances-cards-page-${i}`, debug);
      if (seenCards.size >= paginationText.total) break;
    }
  }

  return cards;
}

async function scrapeVisibleCards(page) {
  return await page.evaluate(() => {
    const cards = [];
    const body = document.body.innerText;

    // Cards use bullet chars (••••) not asterisks, and type/number are on separate lines
    const cardPattern = /(CORPORATE(?:\s+EXECUTIVE)?)\s*\n[•·*]{3,4}\s*(\d{4})/g;
    let match;

    while ((match = cardPattern.exec(body)) !== null) {
      const type = match[1].trim();
      const lastFour = match[2];
      const name = `${type} **** ${lastFour}`;

      const afterMatch = body.substring(match.index, match.index + 400);

      const disponibleMatch = afterMatch.match(/Disponible\s*\n\$\s*([\d.,]+)/);
      const utilizadoMatch = afterMatch.match(/Utilizado\s*\n\$\s*([\d.,]+)/);

      cards.push({
        name,
        disponible: disponibleMatch ? disponibleMatch[1] : null,
        utilizado: utilizadoMatch ? utilizadoMatch[1] : null,
      });
    }

    return cards;
  });
}

async function scrapeCardDetails(page, cards, debug) {
  console.log("6. Navigating to credit card details...");

  const tcLink = page.locator('a:has-text("Saldos y Movimientos No facturados TC"), a:has-text("Saldos y Movimientos No Facturados")').first();
  if (!await tcLink.isVisible().catch(() => false)) {
    console.log("   Credit card detail link not found, skipping.");
    return;
  }
  await tcLink.click();
  await page.waitForTimeout(3000);

  // A modal "Seleccione una tarjeta" may appear
  const modal = page.locator('[role="dialog"], .mat-dialog-container, .cdk-overlay-pane').first();
  const modalVisible = await modal.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);

  if (modalVisible) {
    await page.waitForTimeout(1000);
    await screenshot(page, "balances-tc-modal", debug);

    // Select the first individual card in the modal
    const firstCardLastFour = cards.length > 0 ? cards[0].name.split('**** ')[1] : null;
    if (firstCardLastFour) {
      const cardRow = modal.locator(`text=****${firstCardLastFour}`).first();
      if (await cardRow.isVisible().catch(() => false)) {
        await cardRow.click();
        await page.waitForTimeout(500);
      }
    }

    const acceptBtn = modal.locator('button:has-text("ACEPTAR"), button:has-text("Aceptar")').first();
    if (await acceptBtn.isVisible().catch(() => false)) {
      await acceptBtn.click();
    }
    await page.waitForTimeout(4000);
  }

  // Wait for the card detail page to load
  await page.waitForFunction(
    () => /NACIONAL|INTERNACIONAL|Cupo/i.test(document.body.innerText),
    { timeout: 15000 }
  ).catch(() => {});
  await page.waitForTimeout(1000);
  await screenshot(page, "balances-tc-detail", debug);

  // Scrape the currently displayed card
  const scrapeCurrentAndMatch = async (cardIndex) => {
    const lastFour = await page.evaluate(() => {
      const match = document.body.innerText.match(/\*{3,4}\s*(\d{4})/);
      return match ? match[1] : null;
    });
    const matchingCard = cards.find(c => c.name.endsWith(lastFour));
    if (matchingCard) {
      console.log(`   Scraping ${matchingCard.name}...`);
      await enrichCardFromPage(page, matchingCard);
    }
    await screenshot(page, `balances-tc-card-${cardIndex}`, debug);
    return lastFour;
  };

  // Scrape first card (already displayed)
  const seenCardNums = new Set();
  const firstNum = await scrapeCurrentAndMatch(0);
  if (firstNum) seenCardNums.add(firstNum);

  // Use "SELECCIONAR UNA TARJETA" button to switch to remaining cards
  const switchLink = page.locator('#btn-abrirModal').first();
  const remainingCards = cards.filter(c => !seenCardNums.has(c.name.split('**** ')[1]));

  for (let i = 0; i < remainingCards.length; i++) {
    if (!await switchLink.isVisible().catch(() => false)) break;

    await switchLink.click();
    await page.waitForTimeout(2000);

    const targetLastFour = remainingCards[i].name.split('**** ')[1];
    const modalAgain = page.locator('[role="dialog"], .mat-dialog-container, .cdk-overlay-pane').first();
    await modalAgain.waitFor({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const targetRow = modalAgain.locator(`text=****${targetLastFour}`).first();
    if (await targetRow.isVisible().catch(() => false)) {
      await targetRow.click();
      await page.waitForTimeout(500);
    } else {
      console.log(`   Could not find card ****${targetLastFour} in modal`);
    }

    const acceptBtn = modalAgain.locator('button:has-text("ACEPTAR")').first();
    if (await acceptBtn.isVisible().catch(() => false)) {
      await acceptBtn.click();
    }
    await page.waitForTimeout(4000);

    await page.waitForFunction(
      () => /NACIONAL|INTERNACIONAL|Cupo/i.test(document.body.innerText),
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(1000);

    await scrapeCurrentAndMatch(i + 1);
  }
}

async function enrichCardFromPage(page, card) {
  const data = await page.evaluate(() => {
    const body = document.body.innerText;
    const result = {};

    // INTERNACIONAL (USD) section
    const intlStart = body.indexOf('INTERNACIONAL');
    if (intlStart !== -1) {
      const intlSection = body.substring(intlStart, intlStart + 500);
      const disponibleMatch = intlSection.match(/Cupo Disponible\s*\n\s*USD\s*([\d.,]+)/);
      if (disponibleMatch) result.intlDisponible = disponibleMatch[1];
      const utilizadoMatch = intlSection.match(/Cupo Utilizado\s*\nUSD\s*([\d.,]+)/);
      if (utilizadoMatch) result.intlUtilizado = utilizadoMatch[1];
      const totalMatch = intlSection.match(/Cupo Total\s*\nUSD\s*([\d.,]+)/);
      if (totalMatch) result.intlTotal = totalMatch[1];
    }

    // NACIONAL (CLP) section — update with detail page values
    const naclStart = body.indexOf('NACIONAL');
    if (naclStart !== -1) {
      const naclSection = body.substring(naclStart, naclStart + 500);
      const naclDisp = naclSection.match(/Cupo Disponible\s*\n\s*\$\s*([\d.,]+)/);
      if (naclDisp) result.disponible = naclDisp[1];
      const naclUtil = naclSection.match(/Cupo Utilizado\s*\n\$\s*([\d.,]+)/);
      if (naclUtil) result.utilizado = naclUtil[1];
      const naclTotal = naclSection.match(/Cupo Total\s*\n\$\s*([\d.,]+)/);
      if (naclTotal) result.total = naclTotal[1];
    }

    return result;
  });

  if (data.intlDisponible) card.intlDisponible = data.intlDisponible;
  if (data.intlUtilizado) card.intlUtilizado = data.intlUtilizado;
  if (data.intlTotal) card.intlTotal = data.intlTotal;
  if (data.disponible) card.disponible = data.disponible;
  if (data.utilizado) card.utilizado = data.utilizado;
  if (data.total) card.total = data.total;
}

function printBalances(accounts, cards, json) {
  if (json) {
    console.log(JSON.stringify({ accounts, creditCards: cards }, null, 2));
    return;
  }

  console.log("\n=== Cuentas ===\n");
  if (accounts.length === 0) {
    console.log("  No accounts found.");
  } else {
    for (const acct of accounts) {
      console.log(`  Cuenta Corriente ${acct.account || ''}`);
      console.log(`    Saldo disponible:  $ ${acct.saldoDisponible || 'N/A'}`);
      console.log(`    Línea disponible:  $ ${acct.lineaDisponible || 'N/A'}`);
    }
  }

  console.log("\n=== Tarjetas de Crédito ===\n");
  if (cards.length === 0) {
    console.log("  No credit cards found.");
  } else {
    for (const card of cards) {
      console.log(`  ${card.name}`);
      console.log(`    Nacional:       Disponible $ ${card.disponible || 'N/A'}  |  Utilizado $ ${card.utilizado || 'N/A'}`);
      if (card.intlDisponible || card.intlUtilizado) {
        console.log(`    Internacional:  Disponible US$ ${card.intlDisponible || 'N/A'}  |  Utilizado US$ ${card.intlUtilizado || 'N/A'}`);
      }
    }
  }
  console.log("");
}

module.exports = function (program) {
  program
    .command("balances")
    .description("Show balances for all accounts and credit cards")
    .option("--headless", "Run in headless mode", false)
    .option("--debug", "Take screenshots at each step", false)
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      console.log("\nBanconexion Balances\n");

      const { browser, page } = await createBrowser(opts);

      try {
        await login(page, opts);

        await screenshot(page, "balances-dashboard", opts.debug);

        const accounts = await scrapeAccountBalances(page);
        const cards = await scrapeCreditCards(page, opts.debug);

        // Navigate to TC detail page for national + international balances
        await scrapeCardDetails(page, cards, opts.debug);

        printBalances(accounts, cards, opts.json);
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
