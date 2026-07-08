#!/usr/bin/env node
/**
 * Recover PTS Chrome from stale subscriptionExpired / auth redirect pages.
 * Does not stop bulk download — only navigates the live PTS tab.
 *
 * Usage:
 *   node scripts/recover-pts-chrome-session.js
 *   node scripts/recover-pts-chrome-session.js --export-cookies
 */
require("ts-node/register/transpile-only");
const { chromium } = require("playwright");
const {
  isPtsAuthFailureUrl,
  recoverPtsPageSession,
} = require("../src/ptsAuth");

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const exportCookies = process.argv.includes("--export-cookies");

(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const ptsPages = pages.filter((p) => p.url().includes("dealerconnection.com"));

  if (!ptsPages.length) {
    console.error("No PTS Chrome tabs found. Run ./scripts/launch-pts-chrome.sh");
    process.exit(1);
  }

  let recovered = false;
  for (const page of ptsPages) {
    const before = page.url();
    if (!isPtsAuthFailureUrl(before)) {
      console.log(`OK tab already healthy: ${before}`);
      recovered = true;
      continue;
    }
    if (await recoverPtsPageSession(page)) {
      console.log(`Recovered: ${before} → ${page.url()}`);
      recovered = true;
    }
  }

  if (!recovered) {
    console.error(
      "Could not recover PTS session. In Chrome: motorcraftservice.com → My Subscriptions → open PTS."
    );
    process.exit(1);
  }

  if (exportCookies) {
    const { execFileSync } = require("child_process");
    const path = require("path");
    execFileSync("node", [path.join(__dirname, "export-cookies-from-chrome.js")], {
      stdio: "inherit",
    });
  }

  await browser.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
