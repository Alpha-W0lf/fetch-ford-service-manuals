#!/usr/bin/env ts-node
import { chromium } from "playwright";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

async function waitForVehicle(page: import("playwright").Page, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.goto("https://www.fordtechservice.dealerconnection.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const text = await page.locator("body").innerText();
    if (!/No Vehicle Selected/i.test(text)) {
      return text.slice(0, 200).replace(/\s+/g, " ");
    }
    await page.waitForTimeout(2000);
  }
  return null;
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages().find((p) => p.url().includes("fordtechservice"))!;

  const requests: string[] = [];
  context.on("request", (r) => {
    const u = r.url();
    if (/TreeAndCover|workshop|TableofContent|LoadVehicle|ProcessVin|oasis/i.test(u)) {
      requests.push(`${r.method()} ${u.slice(0, 160)}`);
    }
  });

  await page.goto("https://www.fordtechservice.dealerconnection.com/Home/VehicleMenu", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.locator("#yearmodelselect").click().catch(() => {});
  await page.locator("#yearList a").filter({ hasText: "2009" }).first().click();
  await page.waitForTimeout(1500);
  await page.locator("#modelList a").filter({ hasText: "F-150" }).first().click();
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    (window as any).getexamplevin();
  });
  await page.waitForTimeout(3000);
  const vin = await page.locator("#vin").inputValue();
  console.log("VIN:", vin);

  await page.evaluate(() => {
    (window as any).$("#registration").val("");
    (window as any).onClickSubmit(true);
    (window as any).updateStartingTab("Vin");
    if (typeof (window as any).ROAPI === "function") (window as any).ROAPI();
  });

  console.log("Waiting for vehicle commit...");
  const header = await waitForVehicle(page, 90000);
  console.log("Vehicle header:", header || "STILL No Vehicle Selected");

  if (header) {
    requests.length = 0;
    await page.getByRole("link", { name: "Workshop", exact: true }).click();
    await page.waitForTimeout(10000);
    await page.getByRole("link", { name: "Wiring", exact: true }).click();
    await page.waitForTimeout(10000);
    console.log("Capture requests:\n", requests.join("\n") || "(none)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
