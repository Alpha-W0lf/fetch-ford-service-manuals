import { readdir, stat } from "fs/promises";
import { join } from "path";
import { fileExistsNonEmpty, sanitizeName } from "./utils";

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

/** Legacy downloads may use `:` where sanitized paths use `-` (or vice versa). */
export function pathColonDashVariants(relPath: string): string[] {
  const variants = new Set([relPath]);
  variants.add(relPath.replace(/(\d+)- /g, "$1: "));
  variants.add(relPath.replace(/(\d+): /g, "$1- "));
  variants.add(relPath.replace(/: /g, "- "));
  variants.add(relPath.replace(/- /g, ": "));
  return [...variants];
}

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
