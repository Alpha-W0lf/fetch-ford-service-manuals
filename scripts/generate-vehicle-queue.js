#!/usr/bin/env node
/**
 * Generates templates/vehicles.json with a long prioritized queue.
 * Breadth-first: one anchor year per generation (tier 1), then fill years (tier 2+).
 *
 * WARNING: Do not run on a live queue with download progress — it resets most statuses.
 * To add vehicles without reordering, use: node scripts/append-vehicle-queue.js
 *
 * Status values:
 *   complete      — downloaded
 *   pending       — params ready, waiting for download
 *   needs_params  — in queue but params.json not captured yet
 *   skip          — intentionally excluded
 *   failed        — download failed; retry after fixing
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "templates/vehicles.json");

/** @typedef {{ years: number[], label: string, ptsModel?: string, category?: string, categoryDescription?: string }} Gen */
/** @typedef {{ generations: Gen[], fillYears?: number[] }} ModelDef */

/** @type {Record<string, ModelDef>} */
const TRUCKS_COMMERCIAL = {
  "f-150": {
    generations: [
      { years: [2009, 2010, 2011, 2012, 2013, 2014], label: "F-150 12th gen", ptsModel: "F-150" },
      { years: [2015, 2016, 2017, 2018, 2019, 2020], label: "F-150 13th gen", ptsModel: "F-150" },
      { years: [2021, 2022, 2023, 2024], label: "F-150 14th gen", ptsModel: "F-150" },
    ],
  },
  "f-250": {
    generations: [
      { years: [2008, 2009, 2010], label: "Super Duty 3rd gen (early)", ptsModel: "F-250" },
      { years: [2011, 2012, 2013, 2014, 2015, 2016], label: "Super Duty 3rd gen 6.7L", ptsModel: "F-250" },
      { years: [2017, 2018, 2019, 2020, 2021, 2022], label: "Super Duty 4th gen", ptsModel: "F-250" },
      { years: [2023, 2024], label: "Super Duty 5th gen", ptsModel: "F-250" },
    ],
  },
  "f-350": {
    generations: [
      { years: [2011], label: "F-350 (same platform as F-250)", ptsModel: "F-350" },
      { years: [2017], label: "F-350 4th gen anchor", ptsModel: "F-350" },
      { years: [2023], label: "F-350 5th gen anchor", ptsModel: "F-350" },
    ],
  },
  "f-450": {
    generations: [
      { years: [2017], label: "F-450 chassis (4th gen)", ptsModel: "F-450" },
      { years: [2023], label: "F-450 chassis (5th gen)", ptsModel: "F-450" },
    ],
  },
  "f-550": {
    generations: [
      { years: [2017], label: "F-550 chassis (4th gen)", ptsModel: "F-550" },
      { years: [2023], label: "F-550 chassis (5th gen)", ptsModel: "F-550" },
    ],
  },
  transit: {
    generations: [
      { years: [2015, 2016, 2017, 2018, 2019], label: "Transit Mk1 US", ptsModel: "Transit" },
      { years: [2020, 2021, 2022, 2023, 2024], label: "Transit refresh/gen2 US", ptsModel: "Transit" },
    ],
  },
  "transit-connect": {
    generations: [
      { years: [2014], label: "Transit Connect 2nd gen", ptsModel: "Transit Connect" },
      { years: [2022], label: "Transit Connect 3rd gen", ptsModel: "Transit Connect" },
    ],
  },
  "e-series": {
    generations: [
      { years: [2009], label: "E-Series van (legacy)", ptsModel: "E-350" },
      { years: [2016], label: "E-Series late legacy", ptsModel: "E-350" },
    ],
  },
  ranger: {
    generations: [
      { years: [2011, 2012], label: "Ranger US exit era", ptsModel: "Ranger" },
      { years: [2019, 2020, 2021, 2022, 2023, 2024], label: "Ranger T6 US return", ptsModel: "Ranger" },
    ],
  },
  maverick: {
    generations: [{ years: [2022, 2023, 2024], label: "Maverick", ptsModel: "Maverick" }],
  },
  "f-650": {
    generations: [
      { years: [2016], label: "F-650 medium duty", ptsModel: "F-650" },
      { years: [2023], label: "F-650 medium duty (newer)", ptsModel: "F-650" },
    ],
  },
  "f-750": {
    generations: [
      { years: [2016], label: "F-750 medium duty", ptsModel: "F-750" },
      { years: [2023], label: "F-750 medium duty (newer)", ptsModel: "F-750" },
    ],
  },
};

/** Fleet / work SUVs often in commercial fleets */
const FLEET_SUV = {
  expedition: {
    generations: [
      { years: [2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014], label: "Expedition U324", ptsModel: "Expedition" },
      { years: [2015, 2016, 2017], label: "Expedition U553 early", ptsModel: "Expedition" },
      { years: [2018, 2019, 2020, 2021, 2022, 2023, 2024], label: "Expedition U553", ptsModel: "Expedition" },
    ],
  },
  "expedition-max": {
    generations: [{ years: [2018, 2022], label: "Expedition Max", ptsModel: "Expedition Max" }],
  },
  explorer: {
    generations: [
      { years: [2011, 2012, 2013, 2014, 2015], label: "Explorer 5th gen", ptsModel: "Explorer" },
      { years: [2016, 2017, 2018, 2019], label: "Explorer 6th gen", ptsModel: "Explorer" },
      { years: [2020, 2021, 2022, 2023, 2024], label: "Explorer 6th gen refresh", ptsModel: "Explorer" },
    ],
  },
  "police-interceptor-utility": {
    generations: [
      { years: [2016], label: "Police Interceptor Utility (PTS: Explorer)", ptsModel: "Explorer" },
      { years: [2020], label: "Police Interceptor Utility refresh (PTS: Explorer)", ptsModel: "Explorer" },
    ],
  },
  "police-interceptor-sedan": {
    generations: [{ years: [2014], label: "Police Interceptor Sedan (PTS: Taurus)", ptsModel: "Taurus" }],
  },
};

/** Consumer / secondary priority */
const CONSUMER = {
  mustang: {
    generations: [
      { years: [2011, 2012, 2013, 2014], label: "Mustang S197 late", ptsModel: "Mustang" },
      { years: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023], label: "Mustang S550", ptsModel: "Mustang" },
      { years: [2024], label: "Mustang S650", ptsModel: "Mustang" },
    ],
  },
  bronco: {
    generations: [{ years: [2021, 2022, 2023, 2024], label: "Bronco U725", ptsModel: "Bronco" }],
  },
  "bronco-sport": {
    generations: [{ years: [2021, 2022, 2023, 2024], label: "Bronco Sport", ptsModel: "Bronco Sport" }],
  },
  escape: {
    generations: [
      { years: [2013, 2014, 2015, 2016], label: "Escape 3rd gen", ptsModel: "Escape" },
      { years: [2017, 2018, 2019], label: "Escape 4th gen", ptsModel: "Escape" },
      { years: [2020, 2021, 2022, 2023, 2024], label: "Escape 4th gen refresh", ptsModel: "Escape" },
    ],
  },
  edge: {
    generations: [
      { years: [2015, 2016, 2017, 2018], label: "Edge 2nd gen", ptsModel: "Edge" },
      { years: [2019, 2020, 2021, 2022, 2023, 2024], label: "Edge 2nd gen refresh", ptsModel: "Edge" },
    ],
  },
  fusion: {
    generations: [
      { years: [2013, 2014, 2015, 2016], label: "Fusion 2nd gen", ptsModel: "Fusion" },
      { years: [2017, 2018, 2019, 2020], label: "Fusion 2nd gen late", ptsModel: "Fusion" },
    ],
  },
  focus: {
    generations: [
      { years: [2012, 2013, 2014, 2015, 2016, 2017, 2018], label: "Focus 3rd gen US", ptsModel: "Focus" },
    ],
  },
  fiesta: {
    generations: [{ years: [2014, 2015, 2016, 2017, 2018, 2019], label: "Fiesta US", ptsModel: "Fiesta" }],
  },
  taurus: {
    generations: [{ years: [2013, 2014, 2015, 2016, 2017, 2018, 2019], label: "Taurus 6th gen", ptsModel: "Taurus" }],
  },
  flex: {
    generations: [{ years: [2013, 2014, 2015, 2016, 2017, 2018, 2019], label: "Flex", ptsModel: "Flex" }],
  },
  "crown-victoria": {
    generations: [{ years: [2011], label: "Crown Victoria (fleet legacy)", ptsModel: "Crown Victoria" }],
  },
};

function slug(year, modelKey) {
  return `${year}-${modelKey}`;
}

function buildEntries(group, tierBase, groupLabel) {
  const vehicles = [];
  let priority = tierBase * 1000;

  for (const [modelKey, def] of Object.entries(group)) {
    for (const gen of def.generations) {
      if (!gen.years.length) continue;
      const anchorYear = gen.years[0];
      const anchorId = slug(anchorYear, modelKey);

      // Tier 1 breadth: first year of each generation
      vehicles.push({
        id: anchorId,
        label: `${anchorYear} ${gen.ptsModel || modelKey} — ${gen.label} (anchor)`,
        ptsModel: gen.ptsModel || modelKey,
        modelYear: anchorYear,
        generation: gen.label,
        tier: tierBase,
        phase: "breadth",
        priority: priority++,
        paramsFile: `vehicles/${anchorId}/params.json`,
        outputDir: `manuals/${anchorId}`,
        status: anchorId === "2016-transit" ? "complete" : "needs_params",
        workshop: true,
        wiring: true,
      });

      // Tier 2+: remaining years in generation (fill-in)
      for (const year of gen.years.slice(1)) {
        const id = slug(year, modelKey);
        vehicles.push({
          id,
          label: `${year} ${gen.ptsModel || modelKey} — ${gen.label}`,
          ptsModel: gen.ptsModel || modelKey,
          modelYear: year,
          generation: gen.label,
          tier: tierBase + 1,
          phase: "fill",
          priority: priority++,
          paramsFile: `vehicles/${id}/params.json`,
          outputDir: `manuals/${id}`,
          status: "needs_params",
          workshop: true,
          wiring: true,
        });
      }
    }
  }
  return vehicles;
}

const existing = fs.existsSync(OUT)
  ? JSON.parse(fs.readFileSync(OUT, "utf8"))
  : null;
const statusById = new Map();
if (existing?.vehicles) {
  for (const v of existing.vehicles) {
    statusById.set(v.id, v.status);
  }
}

let vehicles = [
  ...buildEntries(TRUCKS_COMMERCIAL, 1, "trucks"),
  ...buildEntries(FLEET_SUV, 2, "fleet"),
  ...buildEntries(CONSUMER, 3, "consumer"),
];

// Preserve complete/pending/failed status from existing queue
vehicles = vehicles.map((v) => {
  const prev = statusById.get(v.id);
  if (prev === "complete" || prev === "pending" || prev === "failed") {
    return { ...v, status: prev };
  }
  return v;
});

const queue = {
  cookieFile: "templates/cookieString.txt",
  parallel: 2,
  defaults: {
    workshop: true,
    wiring: true,
    flags: ["--noCookieTest", "--ignoreSaveErrors"],
  },
  vehicles,
};

fs.writeFileSync(OUT, JSON.stringify(queue, null, 2) + "\n");

const counts = vehicles.reduce((acc, v) => {
  acc[v.status] = (acc[v.status] || 0) + 1;
  return acc;
}, {});

console.log(`Wrote ${vehicles.length} vehicles to ${OUT}`);
console.log("Status:", counts);
console.log("Tier 1 (breadth anchors):", vehicles.filter((v) => v.tier === 1).length);
