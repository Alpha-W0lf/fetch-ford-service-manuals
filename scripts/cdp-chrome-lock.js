/**
 * Mutual exclusion for PTS Chrome (CDP :9222) between bulk connector jobs and capture-params.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LOCK_DIR = path.join(ROOT, "logs/cdp-chrome.lock");

function lockInfo() {
  if (!fs.existsSync(LOCK_DIR)) return null;
  try {
    const holder = fs.readFileSync(path.join(LOCK_DIR, "holder"), "utf8").trim();
    const pid = fs.readFileSync(path.join(LOCK_DIR, "pid"), "utf8").trim();
    return { holder, pid };
  } catch {
    return { holder: "unknown", pid: "?" };
  }
}

function isLocked() {
  return fs.existsSync(LOCK_DIR);
}

function isPidAlive(pid) {
  const n = parseInt(String(pid), 10);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function removeStaleLockIfNeeded() {
  if (!fs.existsSync(LOCK_DIR)) return false;
  const info = lockInfo();
  if (info && isPidAlive(info.pid)) return false;
  console.warn(
    `[cdp-lock] removing stale lock (holder=${info?.holder || "?"}, pid=${info?.pid || "?"})`
  );
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  return true;
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function acquire(holder, maxWaitMs = 0) {
  const start = Date.now();
  while (true) {
    removeStaleLockIfNeeded();
    try {
      fs.mkdirSync(LOCK_DIR);
      fs.writeFileSync(path.join(LOCK_DIR, "holder"), `${holder}\n`);
      fs.writeFileSync(path.join(LOCK_DIR, "pid"), `${process.pid}\n`);
      fs.writeFileSync(
        path.join(LOCK_DIR, "since"),
        `${new Date().toISOString()}\n`
      );
      return true;
    } catch {
      if (maxWaitMs > 0 && Date.now() - start < maxWaitMs) {
        const info = lockInfo();
        console.log(
          `[cdp-lock] waiting for ${info?.holder || "holder"} (${Math.round((Date.now() - start) / 1000)}s)...`
        );
        const remaining = maxWaitMs - (Date.now() - start);
        sleepMs(Math.min(5000, remaining));
        continue;
      }
      return false;
    }
  }
}

function release(holder) {
  if (!fs.existsSync(LOCK_DIR)) return;
  try {
    const current = fs.readFileSync(path.join(LOCK_DIR, "holder"), "utf8").trim();
    if (holder && current !== holder) return;
  } catch {
    /* release anyway */
  }
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

function waitUntilFree(maxWaitMs = 600000) {
  const start = Date.now();
  while (isLocked()) {
    if (removeStaleLockIfNeeded()) continue;
    if (Date.now() - start >= maxWaitMs) return false;
    const info = lockInfo();
    console.log(`[cdp-lock] held by ${info?.holder || "?"} — waiting...`);
    sleepMs(5000);
  }
  return true;
}

module.exports = {
  LOCK_DIR,
  isLocked,
  lockInfo,
  acquire,
  release,
  waitUntilFree,
};
