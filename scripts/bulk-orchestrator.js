#!/usr/bin/env node
/**
 * Node bulk orchestrator (Guide 04). Invoked from scripts/bulk-download.sh.
 *
 * Usage: node scripts/bulk-orchestrator.js [queue.json]
 */
const { loadConfig, runOrchestrator } = require("../lib/bulk-orchestrator-lib");

async function main() {
  let config;
  try {
    config = loadConfig(process.argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const code = await runOrchestrator(config);
  process.exit(code);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
