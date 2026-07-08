#!/usr/bin/env node
/**
 * Export cookies from PTS Chrome (CDP port 9222) into templates/cookieString.txt.
 * Requires: ./scripts/launch-pts-chrome.sh running and logged into PTS.
 *
 * Usage: node scripts/export-cookies-from-chrome.js [output-path]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const OUT =
  process.argv[2] || path.join(ROOT, "templates", "cookieString.txt");

const URLS = [
  "https://www.fordtechservice.dealerconnection.com",
  "https://fordtechservice.dealerconnection.com",
  "https://www.fordservicecontent.com",
  "https://fordservicecontent.com",
  "https://sso.fordservicecontent.com",
];

const PRIORITY = [
  "CONTENT_AUTH",
  "CONTENT_PERMISSIONS",
  "ASP.NET_SessionId",
  "Ford.TSO.PTSSuite",
  "TPS%2DMEMBERSHIP",
  "TPS%2DPERM",
  "PERSISTENT",
  "PREFERENCES",
  "SSSCParameter",
  "bm_sv",
  "bm_mi",
  "AKA_A2",
];

const SKIP = new Set(["ak_bmsc"]);

const AUTH_FAIL = /subscriptionExpired|signin|login|oauth|account\.microsoft/i;

async function findPtsTab(contexts) {
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      const url = page.url();
      if (
        url.includes("dealerconnection.com") &&
        !AUTH_FAIL.test(url)
      ) {
        return { ctx, page, url };
      }
    }
  }
  return null;
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  if (!contexts.length) {
    console.error("No browser contexts on CDP — is PTS Chrome open?");
    process.exit(1);
  }

  const ptsTab = await findPtsTab(contexts);
  if (!ptsTab) {
    console.error(
      "No logged-in PTS tab found in Chrome. Open https://www.fordtechservice.dealerconnection.com and log in, then retry."
    );
    await browser.close();
    process.exit(1);
  }
  console.log(`PTS tab: ${ptsTab.url}`);

  const map = new Map();
  for (const ctx of contexts) {
    for (const c of await ctx.cookies(URLS)) {
      if (!SKIP.has(c.name)) map.set(c.name, c.value);
    }
  }

  const used = new Set();
  const parts = [];
  for (const k of PRIORITY) {
    if (map.has(k)) {
      parts.push(`${k}=${map.get(k)}`);
      used.add(k);
    }
  }
  for (const [k, v] of [...map.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (!used.has(k)) parts.push(`${k}=${v}`);
  }

  fs.writeFileSync(OUT, parts.join("; "));
  console.log(`Wrote ${parts.length} cookies → ${OUT}`);

  for (const k of [
    "CONTENT_AUTH",
    "CONTENT_PERMISSIONS",
    "Ford.TSO.PTSSuite",
    "TPS%2DMEMBERSHIP",
    "ASP.NET_SessionId",
  ]) {
    console.log(`  ${k}: ${map.has(k) ? "ok" : "MISSING"}`);
  }

  await browser.close();
})().catch((err) => {
  console.error(err.message || err);
  console.error(`Connect failed — run: ./scripts/launch-pts-chrome.sh`);
  process.exit(1);
});
