/**
 * Capture-gaps audit helpers (TOC/disk/log backfill).
 */
const {
  sanitizeName,
  buildExistingPathIndex,
  fileExistsForGap,
} = require("./path-resolve-lib");

function workshopGapId(docId) {
  return `workshop:${docId}`;
}

function wiringConnectorGapId(cell, connectorName) {
  return `wiring-connector:${cell}:${connectorName}`;
}

function gapReasonFromError(msg) {
  const s = String(msg);
  if (/timeout/i.test(s)) return "timeout";
  if (/403|access denied/i.test(s)) return "auth";
  if (/browser has been closed/i.test(s)) return "browser-closed";
  return "error";
}

/** Walk workshop toc.json; yield { name, docId, relDir } */
function walkWorkshopToc(toc, relDir = "") {
  const leaves = [];
  for (const [name, val] of Object.entries(toc || {})) {
    if (typeof val === "string" && val.length > 0) {
      if (val.startsWith("http") && val.includes(".pdf")) {
        const file = val.slice(val.lastIndexOf("/"));
        leaves.push({
          name,
          docId: `url:${val}`,
          relDir,
          expectedFile: pathJoin(relDir, file),
          section: "workshop",
        });
      } else if (!val.includes("/")) {
        let filename = sanitizeName(name);
        if (filename.length > 200) {
          filename =
            filename.slice(0, 254 - 19 - val.length) + ` (${val} truncated)`;
        }
        leaves.push({
          name,
          docId: val,
          relDir,
          expectedFile: pathJoin(relDir, `${filename}.pdf`),
          section: "workshop",
        });
      }
    } else if (val && typeof val === "object") {
      leaves.push(
        ...walkWorkshopToc(val, pathJoin(relDir, sanitizeName(name)))
      );
    }
  }
  return leaves;
}

function pathJoin(a, b) {
  if (!a) return b.replace(/^\/+/, "");
  return `${a}/${b}`.replace(/\/+/g, "/");
}

function fileExistsNonEmpty(fullPath) {
  try {
    const st = require("fs").statSync(fullPath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/** Audit workshop leaves on disk. */
function auditWorkshopLeaves(root, outputDir, tocPath, pathIndex) {
  const fs = require("fs");
  const path = require("path");
  const fullRoot = path.join(root, outputDir);
  if (!fs.existsSync(tocPath)) return [];

  const toc = JSON.parse(fs.readFileSync(tocPath, "utf8"));
  const gaps = [];
  for (const leaf of walkWorkshopToc(toc)) {
    if (!fileExistsForGap(fullRoot, leaf.expectedFile, pathIndex)) {
      gaps.push({
        id: workshopGapId(leaf.docId),
        section: "workshop",
        name: leaf.name,
        docId: leaf.docId.startsWith("url:") ? leaf.docId.slice(4) : leaf.docId,
        relativePath: leaf.relDir,
        expectedFile: leaf.expectedFile,
        reason: "missing-on-disk",
        error: "PDF not found during capture audit",
        attempts: 0,
        lastAttemptAt: new Date().toISOString(),
        source: "toc-audit",
      });
    }
  }
  return gaps;
}

/** Audit connector PDFs from connectors.json manifests. */
function auditConnectors(root, outputDir, pathIndex) {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");
  const fullRoot = path.join(root, outputDir);
  const wiring = path.join(fullRoot, "Wiring");
  if (!fs.existsSync(wiring)) return [];

  let manifests = [];
  try {
    manifests = execSync(
      `find "${wiring}" -name connectors.json 2>/dev/null`,
      { encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }

  const wiringTocPath = path.join(fullRoot, "Wiring", "toc.json");
  let connectorCell = "connectors";
  if (fs.existsSync(wiringTocPath)) {
    try {
      const wiringToc = JSON.parse(fs.readFileSync(wiringTocPath, "utf8"));
      const connDoc = wiringToc.find((d) => d.Type === "Connectors");
      if (connDoc && connDoc.Number) connectorCell = connDoc.Number;
    } catch {
      // keep default
    }
  }

  const gaps = [];
  for (const manifestPath of manifests) {
    const folder = path.dirname(manifestPath);
    const relFolder = path.relative(fullRoot, folder);
    let connectors;
    try {
      connectors = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }

    for (const connector of connectors) {
      let title = `${sanitizeName(connector.Desc)} - ${connector.Name}`;
      if (title.length > 200) {
        title = `${title.slice(0, 150)} (truncated) - ${connector.Name}`;
      }
      const expectedFile = pathJoin(relFolder, `${title}.pdf`);
      if (!fileExistsForGap(fullRoot, expectedFile, pathIndex)) {
        gaps.push({
          id: wiringConnectorGapId(connectorCell, connector.Name),
          section: "wiring-connector",
          name: `${connector.Desc} (${connector.Name})`,
          cell: connectorCell,
          relativePath: relFolder,
          expectedFile,
          reason: "missing-on-disk",
          error: "Connector PDF not found during capture audit",
          attempts: 0,
          lastAttemptAt: new Date().toISOString(),
          source: "connector-audit",
        });
      }
    }
  }
  return gaps;
}

/** Parse vehicle log for recorded skip lines (supplement). */
function gapsFromLog(logPath, existingIds) {
  const fs = require("fs");
  if (!fs.existsSync(logPath)) return [];

  const text = fs.readFileSync(logPath, "utf8");
  const gaps = [];
  const workshopRe =
    /Continuing to download after error with (.+?) \(docID ([^)]+)\): (.+)/g;
  let m;
  while ((m = workshopRe.exec(text)) !== null) {
    const [, name, docId, err] = m;
    const id = workshopGapId(docId);
    if (existingIds.has(id)) continue;
    gaps.push({
      id,
      section: "workshop",
      name,
      docId,
      relativePath: "",
      expectedFile: "",
      reason: gapReasonFromError(err),
      error: err.trim(),
      attempts: 0,
      lastAttemptAt: new Date().toISOString(),
      source: "log-backfill",
    });
    existingIds.add(id);
  }
  return gaps;
}

function mergeGaps(existing, incoming) {
  const byId = new Map();
  for (const g of existing) byId.set(g.id, g);
  for (const g of incoming) {
    const prev = byId.get(g.id);
    if (prev) {
      byId.set(g.id, {
        ...prev,
        ...g,
        attempts: Math.max(prev.attempts || 0, g.attempts || 0),
        expectedFile: g.expectedFile || prev.expectedFile,
        relativePath: g.relativePath || prev.relativePath,
      });
    } else {
      byId.set(g.id, g);
    }
  }
  return [...byId.values()];
}

function auditVehicle(root, outputDir, vehicleId) {
  const path = require("path");
  const fullRoot = path.join(root, outputDir);
  const tocPath = path.join(fullRoot, "toc.json");
  const logPath = path.join(root, "logs", `${vehicleId}.log`);
  const pathIndex = buildExistingPathIndex(fullRoot);

  const fromToc = auditWorkshopLeaves(root, outputDir, tocPath, pathIndex);
  const fromConnectors = auditConnectors(root, outputDir, pathIndex);
  const ids = new Set([...fromToc, ...fromConnectors].map((g) => g.id));
  const fromLog = gapsFromLog(logPath, ids);

  let merged = mergeGaps([], [...fromToc, ...fromConnectors, ...fromLog]);

  // Drop gaps where file appeared since audit started (flexible path match for legacy dirs)
  merged = merged.filter((g) => {
    if (!g.expectedFile) return true;
    return !fileExistsForGap(fullRoot, g.expectedFile, pathIndex);
  });

  // Enrich log-only gaps with expectedFile from toc when possible
  const tocLeaves = auditWorkshopLeaves(root, outputDir, tocPath, pathIndex);
  const leafByDoc = new Map(tocLeaves.map((l) => [workshopGapId(l.docId), l]));
  for (const g of merged) {
    if (g.source === "log-backfill" && !g.expectedFile && g.docId) {
      const leaf = leafByDoc.get(workshopGapId(g.docId));
      if (leaf) {
        g.expectedFile = leaf.expectedFile;
        g.relativePath = leaf.relDir;
      }
    }
  }

  return merged.filter((g) => {
    if (g.source === "log-backfill" && !g.expectedFile) return false;
    if (!g.expectedFile) return true;
    return !fileExistsForGap(fullRoot, g.expectedFile, pathIndex);
  });
}

module.exports = {
  sanitizeName,
  workshopGapId,
  wiringConnectorGapId,
  auditVehicle,
  mergeGaps,
  fileExistsNonEmpty,
  fileExistsForGap,
  buildExistingPathIndex,
};
