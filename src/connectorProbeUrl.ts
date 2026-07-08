import { readFileSync, existsSync } from "fs";
import { join } from "path";

/** Default probe vehicle — known full connector capture in this fleet. */
const DEFAULT_PROBE = {
  vehicleId: "2011-f-150",
  connectorIndex: 0,
};

/**
 * Build a connector face probe URL from on-disk fleet data.
 * Falls back to a generic URL if local manifests are unavailable.
 */
export function getConnectorProbeUrl(root = process.cwd()): string {
  const vid = process.env.CONNECTOR_PROBE_VEHICLE || DEFAULT_PROBE.vehicleId;
  const paramsPath = join(root, "vehicles", vid, "params.json");
  const connPath = join(
    root,
    "manuals",
    vid,
    "Wiring",
    "Connector Views",
    "connectors.json"
  );

  if (existsSync(paramsPath) && existsSync(connPath)) {
    try {
      const params = JSON.parse(readFileSync(paramsPath, "utf8"));
      const connectors = JSON.parse(readFileSync(connPath, "utf8"));
      const idx = parseInt(process.env.CONNECTOR_PROBE_INDEX || "0", 10);
      const connector = connectors[idx] || connectors[0];
      if (connector?.FaceView) {
        const url = new URL(
          "https://www.fordtechservice.dealerconnection.com/wiring/face/"
        );
        url.searchParams.set("book", params.workshop.WiringBookCode);
        url.searchParams.set("vehicleId", params.workshop.vehicleId);
        url.searchParams.set("cell", "150");
        url.searchParams.set("item", connector.FaceView);
        url.searchParams.set("bookType", params.wiring.bookType);
        url.searchParams.set(
          "languageCode",
          params.workshop.languageOdysseyCode
        );
        return url.toString();
      }
    } catch {
      // fall through
    }
  }

  return "https://www.fordtechservice.dealerconnection.com/wiring/face/?book=EGW&vehicleId=5851&cell=150&item=egwcfc107&bookType=svg&languageCode=ENUSA";
}
