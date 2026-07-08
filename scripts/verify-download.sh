#!/usr/bin/env bash
# Quick sanity check for a downloaded manual folder.
# Usage: ./scripts/verify-download.sh manuals/2016-transit
set -euo pipefail

DIR="${1:?Usage: verify-download.sh <manual-output-dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FULL="$ROOT/$DIR"

if [[ ! -d "$FULL" ]]; then
  echo "Not found: $FULL"
  exit 1
fi

node - "$FULL" <<'NODE'
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const dir = process.argv[2];
const wiring = path.join(dir, "Wiring");

function countPdfs(root) {
  try {
    return parseInt(
      execSync(`find "${root}" -name '*.pdf' | wc -l`, { encoding: "utf8" }).trim(),
      10
    );
  } catch {
    return 0;
  }
}

const total = countPdfs(dir);
const wiringPdfs = fs.existsSync(wiring) ? countPdfs(wiring) : 0;
const workshopPdfs = total - wiringPdfs;

console.log("Directory:", dir);
console.log("Workshop PDFs:", workshopPdfs);
console.log("Wiring PDFs:", wiringPdfs);
console.log("Total PDFs:", total);
console.log("cover.html:", fs.existsSync(path.join(dir, "cover.html")) ? "yes" : "no");
console.log("Wiring/toc.json:", fs.existsSync(path.join(wiring, "toc.json")) ? "yes" : "no");

const connDir = path.join(wiring, "Connector Views");
if (fs.existsSync(connDir)) {
  const connPdfs = countPdfs(connDir);
  let expected = "?";
  const j = path.join(connDir, "connectors.json");
  if (fs.existsSync(j)) {
    expected = JSON.parse(fs.readFileSync(j, "utf8")).length;
  }
  console.log("Connector PDFs:", connPdfs + "/" + expected);
}

const zeros = execSync(`find "${dir}" -name '*.pdf' -size 0 2>/dev/null | wc -l`, {
  encoding: "utf8",
}).trim();
console.log("Zero-byte PDFs:", zeros);
NODE
