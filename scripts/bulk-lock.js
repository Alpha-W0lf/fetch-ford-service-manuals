/**
 * Portable bulk-download lock (macOS has no flock in PATH).
 * Stale locks auto-clear when holder pid is dead.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_LOCK_DIR = path.join(ROOT, "logs/bulk-download.lock");

function resolveLockDir(lockDir) {
  return lockDir || process.env.FORD_BULK_LOCK_DIR || DEFAULT_LOCK_DIR;
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

function isStale(lockDir) {
  const dir = resolveLockDir(lockDir);
  if (!fs.existsSync(dir)) return true;
  try {
    const pid = fs.readFileSync(path.join(dir, "pid"), "utf8").trim();
    if (isPidAlive(pid)) return false;
  } catch {
    /* no pid file — treat as stale */
  }
  return true;
}

function readHolderPid(lockDir) {
  const dir = resolveLockDir(lockDir);
  try {
    return fs.readFileSync(path.join(dir, "pid"), "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * @returns {{ ok: true } | { ok: false, holderPid: string }}
 */
function acquireLock(holderPid, lockDir) {
  const dir = resolveLockDir(lockDir);
  const pid = String(holderPid || process.pid);
  if (fs.existsSync(dir) && isStale(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (fs.existsSync(dir)) {
    return { ok: false, holderPid: readHolderPid(dir) || "?" };
  }
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "pid"), `${pid}\n`);
  fs.writeFileSync(path.join(dir, "since"), `${new Date().toISOString()}\n`);
  return { ok: true };
}

function releaseLock(holderPid, lockDir) {
  const dir = resolveLockDir(lockDir);
  if (!fs.existsSync(dir)) return;
  if (holderPid) {
    try {
      const current = fs.readFileSync(path.join(dir, "pid"), "utf8").trim();
      if (current !== String(holderPid)) return;
    } catch {
      /* */
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function acquire(holderPid) {
  const result = acquireLock(holderPid);
  if (!result.ok) {
    console.error(`Another bulk-download.sh is already running (pid ${result.holderPid}).`);
    console.error("Check: ./scripts/queue-status.sh --health");
    process.exit(1);
  }
}

function release(holderPid) {
  releaseLock(holderPid);
}

const cmd = process.argv[2];
const holderPid = process.argv[3];
if (cmd === "acquire") {
  acquire(holderPid);
} else if (cmd === "release") {
  release(holderPid);
} else if (cmd === "is-stale") {
  process.stdout.write(isStale() ? "stale\n" : "held\n");
} else if (require.main === module) {
  console.error("Usage: node bulk-lock.js acquire <pid>|release <pid>|is-stale");
  process.exit(2);
}

module.exports = {
  resolveLockDir,
  isPidAlive,
  isStale,
  acquireLock,
  releaseLock,
};
