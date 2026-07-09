import { readdir, stat } from "fs/promises";
import { join } from "path";
import { pathColonDashVariants, sanitizeName } from "../lib/path-resolve";
import { fileExistsNonEmpty } from "./utils";

async function countPdfsUnder(dir: string): Promise<number> {
  let n = 0;
  async function walk(d: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile() && ent.name.endsWith(".pdf")) n += 1;
    }
  }
  await walk(dir);
  return n;
}

export { pathColonDashVariants };

/** True when a non-empty file exists at expectedFile or a colon/dash path variant. */
export async function fileExistsAtRelPath(
  root: string,
  expectedRel: string
): Promise<boolean> {
  for (const variant of pathColonDashVariants(expectedRel)) {
    if (await fileExistsNonEmpty(join(root, variant))) return true;
  }
  return false;
}

/** Prefer existing legacy workshop subfolder; if duplicates exist, pick the richer tree. */
export async function resolveExistingSubdir(
  parentDir: string,
  segmentName: string
): Promise<string> {
  const sanitized = sanitizeName(segmentName);
  const candidates = [...new Set([sanitized, ...pathColonDashVariants(sanitized)])];
  let best: string | null = null;
  let bestCount = -1;
  for (const c of candidates) {
    const full = join(parentDir, c);
    try {
      const info = await stat(full);
      if (!info.isDirectory()) continue;
      const count = await countPdfsUnder(full);
      if (count > bestCount) {
        best = full;
        bestCount = count;
      }
    } catch {
      /* try next */
    }
  }
  if (best) return best;
  return join(parentDir, sanitized);
}
