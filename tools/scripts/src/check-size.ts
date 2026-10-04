// ADM-NFR-06 · `bun run check:size`: giới hạn dòng mỗi file (spec M0 T-SIZE-1…5, CONVENTIONS §4).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles, listFiles, notIgnored, repoRoot, toRepoPath } from "./lib/git";

export type Violation = { path: string; lines: number; limit: number };

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
const TEST_FILE = /\.(test|spec)\.tsx?$|(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)conftest\.py$/;
const EXEMPT_DIRS = ["/components/ui/", "/migrations/", "/migrations-dev/"];
const EXEMPT_FILE = /\.(gen|generated)\.ts$/;
export const CODE_LIMIT = 400;
export const TEST_LIMIT = 600;

/** Số ký tự `\n`, cộng 1 nếu ký tự cuối không phải `\n`; rỗng = 0. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith("\n") ? n : n + 1;
}

/** Giới hạn dòng của path posix tương đối gốc repo; null = không phải code hoặc được miễn. */
export function limitFor(path: string): number | null {
  if (!CODE_EXT.test(path)) return null;
  const slashed = `/${path}`;
  if (EXEMPT_DIRS.some((d) => slashed.includes(d)) || EXEMPT_FILE.test(path)) return null;
  const isTest =
    TEST_FILE.test(path) ||
    path.startsWith("tests/") ||
    path.startsWith("e2e/") ||
    path.startsWith("apps/agent-runtime/tests/");
  return isTest ? TEST_LIMIT : CODE_LIMIT;
}

export function checkFiles(files: { path: string; text: string }[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    const limit = limitFor(f.path);
    if (limit === null) continue;
    const n = countLines(f.text);
    if (n > limit) out.push({ path: f.path, lines: n, limit });
  }
  return out;
}

function selectFiles(root: string, argv: string[]): string[] {
  if (argv.includes("--all")) return listFiles(root);
  const at = argv.indexOf("--files");
  if (at === -1) return changedFiles(root);
  const given = argv.slice(at + 1).map((p) => toRepoPath(process.cwd(), root, p));
  return notIgnored(root, given);
}

function main(argv: string[]): number {
  const root = repoRoot();
  const paths = selectFiles(root, argv).filter(
    (p) => limitFor(p) !== null && existsSync(join(root, p)),
  );
  const violations = checkFiles(
    paths.map((path) => ({ path, text: readFileSync(join(root, path), "utf8") })),
  );
  for (const v of violations) console.error(`${v.path}: ${v.lines} dòng > ${v.limit}`);
  if (violations.length) return 1;
  console.log(`check:size OK (${paths.length} file)`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
