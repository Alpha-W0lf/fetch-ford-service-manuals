#!/usr/bin/env node
/**
 * Close orphan connector-capture tabs in live PTS Chrome (:9222).
 * Keeps up to PARALLEL wiring/face tabs; removes extras and about:blank tabs.
 *
 * Usage: PARALLEL=2 npx ts-node scripts/prune-cdp-tabs.ts
 */
import { pruneOrphanCdpTabs } from "../src/cdpConnectorPage";

(async () => {
  const maxConnectorTabs = parseInt(process.env.PARALLEL || "2", 10) || 2;
  await pruneOrphanCdpTabs({ maxConnectorTabs });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
