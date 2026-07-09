export function sanitizeName(name: string): string;
export function pathColonDashVariants(relPath: string): string[];
export function buildExistingPathIndex(fullRoot: string): Set<string>;
export function fileExistsForGap(
  fullRoot: string,
  expectedFile: string,
  pathIndex?: Set<string> | null
): boolean;
export function resolveExistingSubdir(
  parentDir: string,
  segmentName: string
): string;
export function statNonEmptyFile(fullPath: string): boolean;
export function statDirectory(fullPath: string): boolean;
export function countPdfsUnder(dir: string): number;
