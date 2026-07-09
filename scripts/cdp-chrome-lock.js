/**
 * Mutual exclusion for PTS Chrome (CDP :9222) between bulk connector jobs and capture-params.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_LOCK_DIR = path.join(ROOT, "logs/cdp-chrome.lock");

function resolveLockDir(lockDir) {
  return lockDir || process.env.FORD_CDP_LOCK_DIR || DEFAULT_LOCK_DIR;
}

function lockInfo(lockDir) {
  const dir = resolveLockDir(lockDir);
  if (!fs.existsSync(dir)) return null;
  try {
    const holder = fs.readFileSync(path.join(dir, "holder"), "utf8").trim();
    const pid = fs.readFileSync(path.join(dir, "pid"), "utf8").trim();
    return { holder, pid };
  } catch {
    return { holder: "unknown", pid: "?" };
  }
}

function isLocked(lockDir) {
  return fs.existsSync(resolveLockDir(lockDir));
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

function removeStaleLockIfNeeded(lockDir) {
  const dir = resolveLockDir(lockDir);
  if (!fs.existsSync(dir)) return false;
  const info = lockInfo(dir);
  if (info && isPidAlive(info.pid)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function acquire(holder, maxWaitMs = 0, lockDir) {
  const dir = resolveLockDir(lockDir);
  const start = Date.now();
  while (true) {
    removeStaleLockIfNeeded(dir);
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "holder"), `${holder}\n`);
      fs.writeFileSync(path.join(dir, "pid"), `${process.pid}\n`);
      fs.writeFileSync(
        path.join(dir, "since"),
        `${new Date().toISOString()}\n`
      );
      return true;
    } catch {
      if (maxWaitMs > 0 && Date.now() - start < maxWaitMs) {
        const info = lockInfo(dir);
        const remaining = maxWaitMs - (Date.now() - start);
        sleepMs(Math.min(5000, remaining));
        continue;
      }
      return false;
    }
  }
}

function release(holder, lockDir) {
  const dir = resolveLockDir(lockDir);
  if (!fs.existsSync(dir)) return;
  try {
    const current = fs.readFileSync(path.join(dir, "holder"), "utf8").trim();
    if (holder && current !== holder) return;
  } catch {
    /* release anyway */
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function waitUntilFree(maxWaitMs = 600000, lockDir) {
  const dir = resolveLockDir(lockDir);
  const start = Date.now();
  while (isLocked(dir)) {
    if (removeStaleLockIfNeeded(dir)) continue;
    if (Date.now() - start >= maxWaitMs) return false;
    sleepMs(5000);
  }
  return true;
}

module.exports = {
  LOCK_DIR: DEFAULT_LOCK_DIR,
  resolveLockDir,
  isLocked,
  lockInfo,
  isPidAlive,
  acquire,
  release,
  waitUntilFree,
  removeStaleLockIfNeeded,
};
