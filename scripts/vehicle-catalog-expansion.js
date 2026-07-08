/**
 * Additional vehicles appended after the base queue (templates/vehicles.json).
 * Same prioritization: trucks/commercial → fleet SUV → consumer/used-lot depth.
 *
 * Used by scripts/append-vehicle-queue.js only — does not reorder existing entries.
 */

/** @typedef {{ years: number[], label: string, ptsModel?: string }} Gen */
/** @typedef {{ generations: Gen[] }} ModelDef */

/** @type {Record<string, ModelDef>} */
const EXPANSION_TRUCKS_COMMERCIAL = {
  excursion: {
    generations: [
      {
        years: [2000, 2001, 2002, 2003, 2004, 2005],
        label: "Excursion U354 (7.3L/6.0L diesel)",
        ptsModel: "Excursion",
      },
    ],
  },
  "f-150": {
    generations: [
      {
        years: [2004, 2005, 2006, 2007, 2008],
        label: "F-150 11th gen",
        ptsModel: "F-150",
      },
    ],
  },
  "f-250": {
    generations: [
      {
        years: [2003, 2004, 2005, 2006, 2007],
        label: "Super Duty 2nd gen late (6.0L/6.4L diesel)",
        ptsModel: "F-250",
      },
    ],
  },
  "f-350": {
    generations: [
      {
        years: [2012, 2013, 2014, 2015, 2016],
        label: "F-350 3rd gen 6.7L (fill)",
        ptsModel: "F-350",
      },
      {
        years: [2018, 2019, 2020, 2021, 2022],
        label: "F-350 4th gen (fill)",
        ptsModel: "F-350",
      },
    ],
  },
  "f-450": {
    generations: [
      {
        years: [2011, 2012, 2013, 2014, 2015, 2016],
        label: "F-450 chassis 3rd gen (fill)",
        ptsModel: "F-450",
      },
      {
        years: [2018, 2019, 2020, 2021, 2022],
        label: "F-450 chassis 4th gen (fill)",
        ptsModel: "F-450",
      },
    ],
  },
  "f-550": {
    generations: [
      {
        years: [2011, 2012, 2013, 2014, 2015, 2016],
        label: "F-550 chassis 3rd gen (fill)",
        ptsModel: "F-550",
      },
      {
        years: [2018, 2019, 2020, 2021, 2022],
        label: "F-550 chassis 4th gen (fill)",
        ptsModel: "F-550",
      },
    ],
  },
  "e-series": {
    generations: [
      {
        years: [2010, 2011, 2012, 2013, 2014, 2015],
        label: "E-Series van/cutaway (legacy fleet)",
        ptsModel: "E-350",
      },
    ],
  },
  "e-transit": {
    generations: [
      {
        years: [2022, 2023, 2024],
        label: "E-Transit commercial van",
        ptsModel: "E-Transit",
      },
    ],
  },
};

/** @type {Record<string, ModelDef>} */
const EXPANSION_FLEET_SUV = {
  navigator: {
    generations: [
      {
        years: [2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017],
        label: "Navigator U326",
        ptsModel: "Navigator",
      },
      {
        years: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
        label: "Navigator U554",
        ptsModel: "Navigator",
      },
    ],
  },
};

/** Used-car lot depth — older high-volume Ford models */
/** @type {Record<string, ModelDef>} */
const EXPANSION_CONSUMER = {
  explorer: {
    generations: [
      {
        years: [2006, 2007, 2008, 2009, 2010],
        label: "Explorer 4th gen (pre-2011)",
        ptsModel: "Explorer",
      },
    ],
  },
  escape: {
    generations: [
      {
        years: [2008, 2009, 2010, 2011, 2012],
        label: "Escape 2nd gen (pre-2013)",
        ptsModel: "Escape",
      },
    ],
  },
  edge: {
    generations: [
      {
        years: [2011, 2012, 2013, 2014],
        label: "Edge 1st gen (pre-2015 refresh)",
        ptsModel: "Edge",
      },
    ],
  },
  fusion: {
    generations: [
      {
        years: [2010, 2011, 2012],
        label: "Fusion 1st gen US (pre-2013)",
        ptsModel: "Fusion",
      },
    ],
  },
  taurus: {
    generations: [
      {
        years: [2010, 2011, 2012],
        label: "Taurus 5th gen (pre-2013)",
        ptsModel: "Taurus",
      },
    ],
  },
  focus: {
    generations: [
      {
        years: [2008, 2009, 2010, 2011],
        label: "Focus 2nd gen US (pre-2012)",
        ptsModel: "Focus",
      },
    ],
  },
  fiesta: {
    generations: [
      {
        years: [2011, 2012, 2013],
        label: "Fiesta US (early)",
        ptsModel: "Fiesta",
      },
    ],
  },
  flex: {
    generations: [
      {
        years: [2009, 2010, 2011, 2012],
        label: "Flex (early)",
        ptsModel: "Flex",
      },
    ],
  },
  "crown-victoria": {
    generations: [
      {
        years: [2008, 2009, 2010],
        label: "Crown Victoria (fleet legacy)",
        ptsModel: "Crown Victoria",
      },
    ],
  },
};

function slug(year, modelKey) {
  return `${year}-${modelKey}`;
}

/**
 * @param {Record<string, ModelDef>} group
 * @param {number} tierBase
 * @param {number} priorityStart
 * @returns {{ vehicles: object[], nextPriority: number }}
 */
function buildExpansionEntries(group, tierBase, priorityStart) {
  const vehicles = [];
  let priority = priorityStart;

  for (const [modelKey, def] of Object.entries(group)) {
    for (const gen of def.generations) {
      if (!gen.years.length) continue;
      const anchorYear = gen.years[0];
      const anchorId = slug(anchorYear, modelKey);

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
        status: "needs_params",
        workshop: true,
        wiring: true,
      });

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

  return { vehicles, nextPriority: priority };
}

function allExpansionVehicles(priorityStart) {
  let priority = priorityStart;
  const chunks = [];

  for (const [group, tier] of [
    [EXPANSION_TRUCKS_COMMERCIAL, 1],
    [EXPANSION_FLEET_SUV, 2],
    [EXPANSION_CONSUMER, 3],
  ]) {
    const built = buildExpansionEntries(group, tier, priority);
    chunks.push(...built.vehicles);
    priority = built.nextPriority;
  }

  return chunks;
}

module.exports = {
  EXPANSION_TRUCKS_COMMERCIAL,
  EXPANSION_FLEET_SUV,
  EXPANSION_CONSUMER,
  allExpansionVehicles,
};
