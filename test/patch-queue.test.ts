import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquirePatchLock,
  patchVehicleStatus,
  releasePatchLock,
} from "../lib/patch-queue.js";

function sampleQueue() {
  return {
    cookieFile: "templates/cookieString.txt",
    vehicles: [
      { id: "v-a", label: "A", paramsFile: "v/a", outputDir: "m/a", status: "pending" },
      { id: "v-b", label: "B", paramsFile: "v/b", outputDir: "m/b", status: "pending" },
      { id: "v-c", label: "C", paramsFile: "v/c", outputDir: "m/c", status: "needs_params" },
    ],
  };
}

describe("patch-queue", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function queueFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ford-patch-queue-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "vehicles.json");
    fs.writeFileSync(file, JSON.stringify(sampleQueue(), null, 2) + "\n");
    return file;
  }

  it("patches one vehicle status and updatedAt", () => {
    const file = queueFile();
    const result = patchVehicleStatus(file, "v-a", "downloading");
    expect(result).toMatchObject({ vehicleId: "v-a", status: "downloading" });
    const q = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(q.vehicles.find((v: { id: string }) => v.id === "v-a").status).toBe(
      "downloading"
    );
    expect(q.vehicles.find((v: { id: string }) => v.id === "v-b").status).toBe(
      "pending"
    );
    expect(fs.existsSync(`${file}.patch-lock`)).toBe(false);
  });

  it("throws when vehicle id missing", () => {
    const file = queueFile();
    expect(() => patchVehicleStatus(file, "missing", "pending")).toThrow(
      /Vehicle not found/
    );
  });

  it("sequential patches to different vehicles all persist", () => {
    const file = queueFile();
    patchVehicleStatus(file, "v-a", "downloading");
    patchVehicleStatus(file, "v-b", "complete");
    const q = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(q.vehicles.find((v: { id: string }) => v.id === "v-a").status).toBe(
      "downloading"
    );
    expect(q.vehicles.find((v: { id: string }) => v.id === "v-b").status).toBe(
      "complete"
    );
  });

  it("interleaved patches via Promise.all all persist (serialized lock)", async () => {
    const file = queueFile();
    await Promise.all([
      Promise.resolve().then(() => patchVehicleStatus(file, "v-a", "downloading")),
      Promise.resolve().then(() => patchVehicleStatus(file, "v-b", "complete")),
      Promise.resolve().then(() => patchVehicleStatus(file, "v-c", "pending")),
    ]);
    const q = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(q.vehicles.find((v: { id: string }) => v.id === "v-a").status).toBe(
      "downloading"
    );
    expect(q.vehicles.find((v: { id: string }) => v.id === "v-b").status).toBe(
      "complete"
    );
    expect(q.vehicles.find((v: { id: string }) => v.id === "v-c").status).toBe(
      "pending"
    );
  });

  it("second acquire times out while lock held, succeeds after release", async () => {
    const file = queueFile();
    expect(acquirePatchLock(file)).toBe(true);

    const blocked = new Promise<boolean>((resolve) => {
      setImmediate(() => resolve(acquirePatchLock(file, 100)));
    });
    await expect(blocked).resolves.toBe(false);

    releasePatchLock(file);
    expect(acquirePatchLock(file)).toBe(true);
    releasePatchLock(file);
  });
});
