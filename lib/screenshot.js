async function screenshot(page, name, debug) {
  if (!debug) return;
  await page.screenshot({ path: `debug-${name}.png`, fullPage: true });
  console.log(`  📸 Screenshot saved: debug-${name}.png`);
}

module.exports = { screenshot };
