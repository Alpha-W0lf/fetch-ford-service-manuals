/**
 * Portable bulk-download lock (macOS has no flock in PATH).
 * Stale locks auto-clear when holder pid is dead.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LOCK_DIR = path.join(ROOT, "logs/bulk-download.lock");

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

function isStale() {
  if (!fs.existsSync(LOCK_DIR)) return true;
  try {
    const pid = fs.readFileSync(path.join(LOCK_DIR, "pid"), "utf8").trim();
    if (isPidAlive(pid)) return false;
  } catch {
    /* no pid file — treat as stale */
  }
  return true;
}

function acquire(holderPid) {
  const pid = String(holderPid || process.pid);
  if (fs.existsSync(LOCK_DIR) && isStale()) {
    console.error("[lock] Removing stale bulk lock");
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(LOCK_DIR)) {
    let holder = "?";
    try {
      holder = fs.readFileSync(path.join(LOCK_DIR, "pid"), "utf8").trim();
    } catch {
      /* */
    }
    console.error(`Another bulk-download.sh is already running (pid ${holder}).`);
    console.error("Check: ./scripts/queue-status.sh --health");
    process.exit(1);
  }
  fs.mkdirSync(LOCK_DIR);
  fs.writeFileSync(path.join(LOCK_DIR, "pid"), `${pid}\n`);
  fs.writeFileSync(path.join(LOCK_DIR, "since"), `${new Date().toISOString()}\n`);
}

function release(holderPid) {
  if (!fs.existsSync(LOCK_DIR)) return;
  if (holderPid) {
    try {
      const current = fs.readFileSync(path.join(LOCK_DIR, "pid"), "utf8").trim();
      if (current !== String(holderPid)) return;
    } catch {
      /* */
    }
  }
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

const cmd = process.argv[2];
const holderPid = process.argv[3];
if (cmd === "acquire") {
  acquire(holderPid);
} else if (cmd === "release") {
  release(holderPid);
} else if (cmd === "is-stale") {
  process.stdout.write(isStale() ? "stale\n" : "held\n");
} else {
  console.error("Usage: node bulk-lock.js acquire <pid>|release <pid>|is-stale");
  process.exit(2);
}
