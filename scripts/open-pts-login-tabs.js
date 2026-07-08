#!/usr/bin/env node
/**
 * Open Motorcraft + PTS tabs in the live PTS Chrome for manual re-login.
 * Use when subscriptionExpired is shown but your Motorcraft subscription is still active.
 * Does not stop bulk download.
 */
const { chromium } = require("playwright");

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  if (!ctx) {
    console.error("No Chrome context — run ./scripts/launch-pts-chrome.sh");
    process.exit(1);
  }

  console.log("Opening Motorcraft My Subscriptions + PTS home for manual login...");
  console.log("In Chrome: log in if needed → My Subscriptions → open your PTS subscription.");
  console.log("Then run: node scripts/export-cookies-from-chrome.js");
  console.log("Bulk will resume automatically after cookies refresh (circuit breaker).");

  const subs = await ctx.newPage();
  await subs.goto("https://www.motorcraftservice.com/MySubscriptions", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const pts = await ctx.newPage();
  await pts.goto("https://www.fordtechservice.dealerconnection.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  console.log(`  Subscriptions tab: ${subs.url()}`);
  console.log(`  PTS tab: ${pts.url()}`);
  await browser.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
