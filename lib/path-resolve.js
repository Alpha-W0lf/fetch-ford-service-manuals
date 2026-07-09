/**
 * Path resolution for workshop PDFs — colon/dash legacy folder variants.
 * Canonical module for JS scripts; TS async wrappers live in src/pathResolve.ts.
 */
const fs = require("fs");
const path = require("path");

const urlUnsafeRegex = /[#?&%:]/gm;
const dashReplaceRegex = /[\\/\0\u2013]/gm;
const removeRegex = /[$\r\n\f\v]/gm;

function sanitizeName(name) {
  return name
    .replace(urlUnsafeRegex, "-")
    .replace(dashReplaceRegex, "-")
    .replace(removeRegex, "");
}

/** Legacy downloads may use `:` where sanitized paths use `-` (or vice versa). */
function pathColonDashVariants(relPath) {
  const variants = new Set([relPath]);
  variants.add(relPath.replace(/(\d+)- /g, "$1: "));
  variants.add(relPath.replace(/(\d+): /g, "$1- "));
  variants.add(relPath.replace(/: /g, "- "));
  variants.add(relPath.replace(/- /g, ": "));
  return [...variants];
}

function statNonEmptyFile(fullPath) {
  try {
    const st = fs.statSync(fullPath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function statDirectory(fullPath) {
  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

/** Index of relative PDF paths on disk (+ colon/dash variants as lookup keys). */
function buildExistingPathIndex(fullRoot) {
  const keys = new Set();
  function walk(dir, rel = "") {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, relPath);
      } else if (ent.isFile() && ent.name.endsWith(".pdf")) {
        keys.add(relPath);
        for (const v of pathColonDashVariants(relPath)) keys.add(v);
      }
    }
  }
  if (fs.existsSync(fullRoot)) walk(fullRoot);
  return keys;
}

/**
 * True when expectedFile exists on disk (exact path, colon/dash variants, or index lookup).
 */
function fileExistsForGap(fullRoot, expectedFile, pathIndex) {
  for (const variant of pathColonDashVariants(expectedFile)) {
    if (statNonEmptyFile(path.join(fullRoot, variant))) return true;
  }
  if (!pathIndex) return false;
  return pathColonDashVariants(expectedFile).some((v) => pathIndex.has(v));
}

function countPdfsUnder(dir) {
  let n = 0;
  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith(".pdf")) n += 1;
    }
  }
  walk(dir);
  return n;
}

/** Resolve workshop subfolder — prefer existing legacy dir; if duplicates exist, pick the richer tree. */
function resolveExistingSubdir(parentDir, segmentName) {
  const sanitized = sanitizeName(segmentName);
  const candidates = [...new Set([sanitized, ...pathColonDashVariants(sanitized)])];
  let best = null;
  let bestCount = -1;
  for (const c of candidates) {
    const full = path.join(parentDir, c);
    if (!statDirectory(full)) continue;
    const count = countPdfsUnder(full);
    if (count > bestCount) {
      best = full;
      bestCount = count;
    }
  }
  if (best) return best;
  return path.join(parentDir, sanitized);
}

module.exports = {
  sanitizeName,
  pathColonDashVariants,
  buildExistingPathIndex,
  fileExistsForGap,
  resolveExistingSubdir,
  statNonEmptyFile,
  statDirectory,
  countPdfsUnder,
};
