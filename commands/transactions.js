const { createBrowser } = require("../lib/browser");
const { login } = require("../lib/login");
const { screenshot } = require("../lib/screenshot");

function parseDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date "${s}" — expected YYYY-MM-DD`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

async function navigateToAccountMovimientos(page, debug) {
  console.log("6. Navigating to Saldos y Movimientos...");
  const link = page.locator(
    'a:has-text("Saldos y Movimientos Cuenta"), a:has-text("Saldos y Movimientos"), a:has-text("Movimientos de Cuenta"), a:has-text("Cartola")'
  ).first();
  await link.waitFor({ timeout: 10000 });
  await link.click();
  await page.waitForTimeout(3000);
  await screenshot(page, "tx-account-page", debug);
}

async function navigateToCardMovimientos(page, billed, debug) {
  console.log(`6. Navigating to TC movimientos (${billed ? "billed" : "unbilled"})...`);

  if (billed) {
    // Direct hash navigation — going via the dashboard link first triggers the unbilled
    // modal whose backdrop intercepts clicks on the Movimientos facturados tab.
    const target = page.url().split('#')[0] + '#/movimientos-tarjeta-credito/movimientos-facturados';
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  } else {
    const link = page.locator(
      'a:has-text("Saldos y Movimientos No facturados TC"), a:has-text("Saldos y Movimientos No Facturados")'
    ).first();
    await link.waitFor({ timeout: 10000 });
    await link.click();
    await page.waitForTimeout(3000);
  }

  await screenshot(page, billed ? "tx-card-billed-page" : "tx-card-unbilled-page", debug);
}

async function readSelectedAccount(page) {
  return await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label*="Cuenta seleccionada" i]');
    if (!btn) return null;
    const aria = btn.getAttribute('aria-label') || '';
    const m = aria.match(/\d{2}-\d{3}-\d+-\d{2}/);
    return m ? m[0] : null;
  });
}

async function selectAccount(page, accountNumber, debug) {
  const current = await readSelectedAccount(page);

  if (!accountNumber) {
    console.log(`7. Using account currently selected on portal: ${current || 'unknown'}`);
    return current;
  }

  const cleanTarget = accountNumber.replace(/[-\s]/g, '');
  if (current && current.replace(/[-\s]/g, '') === cleanTarget) {
    console.log(`7. Account ${current} already selected.`);
    return current;
  }

  console.log(`7. Switching account: ${current || '?'} → ${accountNumber}...`);
  const headerBtn = page.locator('button[aria-label*="Cuenta seleccionada" i]').first();
  await headerBtn.waitFor({ timeout: 10000 });
  await headerBtn.click();
  await page.waitForTimeout(2000);
  await screenshot(page, "tx-account-picker-open", debug);

  const matched = await page.evaluate((target) => {
    const items = Array.from(document.querySelectorAll('li'));
    for (const item of items) {
      const cleanText = (item.innerText || '').replace(/[-\s]/g, '');
      if (cleanText.includes(target)) {
        const radioLabel = item.querySelector('.mat-radio-label');
        if (radioLabel) {
          radioLabel.click();
        } else {
          item.click();
        }
        return (item.innerText || '').trim();
      }
    }
    return null;
  }, cleanTarget);

  if (!matched) {
    const available = await page.evaluate(() =>
      Array.from(document.querySelectorAll('li'))
        .map(el => (el.innerText || '').trim().replace(/\n/g, ' / '))
        .filter(t => /\d{2}-\d{3}-\d+-\d{2}/.test(t))
    );
    console.log("   Available accounts:");
    for (const a of available) console.log(`     - ${a}`);
    throw new Error(`Account "${accountNumber}" not found`);
  }
  console.log(`   Clicked: "${matched.replace(/\n/g, ' / ').substring(0, 80)}"`);

  await page.waitForTimeout(1500);

  // Some pickers require an Aceptar confirmation
  const acceptBtn = page.locator('button:has-text("ACEPTAR"), button:has-text("Aceptar")').first();
  if (await acceptBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await acceptBtn.click();
  }

  // Wait for the header to reflect the new selection
  await page.waitForFunction(
    (target) => {
      const b = document.querySelector('button[aria-label*="Cuenta seleccionada" i]');
      if (!b) return false;
      const m = (b.getAttribute('aria-label') || '').match(/\d{2}-\d{3}-\d+-\d{2}/);
      return m && m[0].replace(/[-\s]/g, '') === target;
    },
    cleanTarget,
    { timeout: 15000 }
  ).catch(() => {});

  await page.waitForTimeout(2000);
  await screenshot(page, "tx-account-selected", debug);

  const finalAccount = await readSelectedAccount(page);
  if (!finalAccount || finalAccount.replace(/[-\s]/g, '') !== cleanTarget) {
    throw new Error(`Failed to switch to ${accountNumber} — header still shows ${finalAccount || 'unknown'}`);
  }
  return finalAccount;
}

async function selectCard(page, lastFour, debug) {
  const modal = page.locator('[role="dialog"], .mat-dialog-container, .cdk-overlay-pane').first();
  const modalVisible = await modal.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);

  if (!modalVisible) {
    console.log("7. No card selection modal — assuming single card.");
    return;
  }

  console.log(`7. Selecting card ending in ${lastFour}...`);
  await page.waitForTimeout(1000);
  await screenshot(page, "tx-card-modal", debug);

  const matched = await page.evaluate((target) => {
    const cardRe = new RegExp(`\\*{3,4}\\s*${target}\\b`);
    // Smallest element that mentions the target card AND contains a radio = the row for that card.
    const candidates = Array.from(document.querySelectorAll('*'))
      .filter(el => {
        const t = el.innerText || '';
        return cardRe.test(t) && el.querySelector('mat-radio-button');
      })
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);

    for (const el of candidates) {
      const radio = el.querySelector('mat-radio-button');
      const radioLabel = radio.querySelector('.mat-radio-label');
      if (radioLabel) radioLabel.click();
      else radio.click();
      return (el.innerText || '').trim();
    }
    return null;
  }, lastFour);

  if (!matched) {
    const available = await page.evaluate(() =>
      [...new Set(
        Array.from(document.body.innerText.matchAll(/\*{3,4}\s*(\d{4})/g)).map(m => m[1])
      )]
    );
    console.log(`   Available cards: ${available.join(', ') || '(none)'}`);
    throw new Error(`Card ending in ${lastFour} not found in modal`);
  }
  console.log(`   Clicked: "${matched.replace(/\n/g, ' / ').substring(0, 80)}"`);

  await page.waitForTimeout(800);
  const acceptBtn = modal.locator('#modalPrimaryBtn, button:has-text("ACEPTAR"), button:has-text("Aceptar")').first();
  if (await acceptBtn.isVisible().catch(() => false)) {
    await acceptBtn.click({ timeout: 10000 });
  }
  await page.waitForTimeout(4000);
  await screenshot(page, "tx-card-selected", debug);
}

async function clickCalendarDate(page, dateStr) {
  const cellSelector = `.mat-calendar-body-cell[aria-label="${dateStr}"]`;
  const [, tD, tM, tY] = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || [];
  if (!tY) throw new Error(`Invalid calendar date: ${dateStr}`);
  const targetMonths = parseInt(tY) * 12 + parseInt(tM);

  for (let attempt = 0; attempt < 36; attempt++) {
    const cell = page.locator(cellSelector).first();
    const visible = await cell.isVisible({ timeout: 500 }).catch(() => false);
    if (visible) {
      const disabled = await cell.evaluate(el =>
        el.classList.contains('mat-calendar-body-disabled') ||
        el.getAttribute('aria-disabled') === 'true'
      ).catch(() => true);
      if (disabled) throw new Error(`Calendar date ${dateStr} is disabled`);
      await cell.click();
      return;
    }

    // Find any visible cell to determine current month
    const visibleAria = await page.locator('.mat-calendar-body-cell')
      .first()
      .getAttribute('aria-label')
      .catch(() => null);
    if (!visibleAria) throw new Error(`Calendar not open or has no day cells`);

    const [, , vM, vY] = visibleAria.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || [];
    if (!vY) throw new Error(`Could not parse visible calendar cell: ${visibleAria}`);
    const visibleMonths = parseInt(vY) * 12 + parseInt(vM);

    if (targetMonths < visibleMonths) {
      await page.locator('.mat-calendar-previous-button').first().click();
    } else if (targetMonths > visibleMonths) {
      await page.locator('.mat-calendar-next-button').first().click();
    } else {
      throw new Error(`Date ${dateStr} not present in calendar grid`);
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`Could not navigate calendar to ${dateStr} after 36 attempts`);
}

async function setDateRange(page, from, to, debug) {
  if (!from && !to) {
    console.log("8. No date range specified — using portal default.");
    return;
  }
  if (!from || !to) {
    console.log("8. Both --from and --to are required for date filtering — skipping.");
    return;
  }

  console.log(`8. Setting date range: ${from} → ${to}...`);

  const toggle = page.locator('button[aria-label="Abrir calendario"]').first();
  await toggle.waitFor({ timeout: 10000 });
  await toggle.click();
  await page.waitForSelector('.mat-calendar-body-cell', { timeout: 10000 });
  await page.waitForTimeout(500);

  await clickCalendarDate(page, from);
  await page.waitForTimeout(400);
  await clickCalendarDate(page, to);

  // Wait for the calendar overlay to close
  await page.waitForFunction(
    () => !document.querySelector('.mat-calendar-body-cell'),
    { timeout: 5000 }
  ).catch(() => {});
  await page.waitForTimeout(2000);

  console.log("   Date range applied.");
  await screenshot(page, "tx-date-range", debug);
}

async function scrapeTransactions(page) {
  await page.waitForFunction(
    () => {
      const tables = Array.from(document.querySelectorAll('table'));
      return tables.some(t => t.querySelectorAll('tbody tr').length > 0);
    },
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    if (tables.length === 0) return { headers: [], rows: [] };

    let bestTable = null;
    let bestRowCount = 0;
    for (const t of tables) {
      const rowCount = t.querySelectorAll('tbody tr').length;
      if (rowCount > bestRowCount) {
        bestRowCount = rowCount;
        bestTable = t;
      }
    }
    if (!bestTable) return { headers: [], rows: [] };

    const headers = Array.from(bestTable.querySelectorAll('thead th, thead td'))
      .map(c => c.innerText.trim().replace(/\s+/g, ' '))
      .filter(Boolean);

    const rows = Array.from(bestTable.querySelectorAll('tbody tr'))
      .map(row =>
        Array.from(row.querySelectorAll('td')).map(c =>
          c.innerText.trim().replace(/\s+/g, ' ')
        )
      )
      .filter(r => r.length > 0 && r.some(c => c.length > 0))
      // Drop expanded detail/aria rows ("Detalle de Movimiento..." panels and statement totals)
      .filter(r => {
        const joined = r.join(' ').trim();
        if (/^Detalle de Movimiento de Tarjeta de Cr/i.test(joined)) return false;
        if (/TOTAL TARJETA\s+X+\d{4}/i.test(joined)) return false;
        if (/No posee informaci[oó]n|No existe Informaci[oó]n para la consulta/i.test(joined)) return false;
        return true;
      });

    return { headers, rows };
  });
}

function printTransactions(data, source, json) {
  if (json) {
    let transactions;
    if (data.headers.length > 0) {
      transactions = data.rows.map(row => {
        const obj = {};
        data.headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });
    } else {
      transactions = data.rows;
    }
    console.log(JSON.stringify({ ...source, transactions }, null, 2));
    return;
  }

  console.log("");
  if (source.account) console.log(`Account: ${source.account}`);
  if (source.card) console.log(`Card: ****${source.card}${source.billed ? " (billed)" : " (unbilled)"}`);
  if (data.rows.length === 0) {
    console.log("No transactions found.");
    return;
  }

  if (data.headers.length > 0 && data.headers.length === (data.rows[0]?.length || 0)) {
    const widths = data.headers.map((h, i) => {
      const colMax = data.rows.reduce((m, r) => Math.max(m, (r[i] || '').length), 0);
      return Math.max(h.length, colMax);
    });
    console.log(data.headers.map((h, i) => h.padEnd(widths[i])).join('  '));
    console.log(widths.map(w => '-'.repeat(w)).join('  '));
    for (const row of data.rows) {
      console.log(row.map((c, i) => (c || '').padEnd(widths[i] || 0)).join('  '));
    }
  } else {
    for (const row of data.rows) {
      console.log(row.join(' | '));
    }
  }
  console.log(`\n${data.rows.length} transactions`);
}

module.exports = function (program) {
  program
    .command("transactions")
    .description("Show transactions for an account or credit card")
    .option("--account <number>", "Account number (e.g. 00-001-70743-06)")
    .option("--card <last4>", "Credit card last 4 digits")
    .option("--billed", "Credit cards only: show billed transactions instead of unbilled", false)
    .option("--from <YYYY-MM-DD>", "Start date")
    .option("--to <YYYY-MM-DD>", "End date")
    .option("--headless", "Run in headless mode", false)
    .option("--debug", "Take screenshots at each step", false)
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      if (opts.account && opts.card) {
        console.error("Error: --account and --card are mutually exclusive");
        process.exit(1);
      }

      const fromDate = parseDate(opts.from);
      const toDate = parseDate(opts.to);

      console.log("\nBanconexion Transactions");
      if (opts.account) console.log(`  Account: ${opts.account}`);
      if (opts.card) console.log(`  Card: ****${opts.card} (${opts.billed ? "billed" : "unbilled"})`);
      if (opts.from) console.log(`  From: ${opts.from}`);
      if (opts.to) console.log(`  To: ${opts.to}`);
      console.log("");

      const { browser, page } = await createBrowser(opts);
      const source = {};

      try {
        await login(page, opts);

        if (opts.card) {
          await navigateToCardMovimientos(page, opts.billed, opts.debug);
          await selectCard(page, opts.card, opts.debug);
          source.card = opts.card;
          source.billed = !!opts.billed;
          if (opts.from || opts.to) {
            console.log("   Note: --from/--to ignored for credit cards.");
            console.log(opts.billed
              ? "         Billed view shows the most recent statement period."
              : "         Unbilled view shows the current open cycle.");
          }
        } else {
          await navigateToAccountMovimientos(page, opts.debug);
          source.account = await selectAccount(page, opts.account, opts.debug);
          await setDateRange(page, fromDate, toDate, opts.debug);
        }

        const data = await scrapeTransactions(page);
        await screenshot(page, "tx-final", opts.debug);
        printTransactions(data, source, opts.json);
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
