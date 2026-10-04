// ADM-NFR-06 · khoá test của qc (spec M0 T-LOCK-1…3, WORKFLOW "Luật khoá test").
// `verify`: mọi agent chạy. `write`: chỉ qc chạy sau Gate.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoRoot } from "./lib/git";

export const LOCK_PATH = "tests/.lock";
export const LOCK_HEADER =
  "# tests/.lock — sinh bởi bun run test:lock:write (chỉ qc). Không sửa tay.";
const LOCKED_DIRS = [
  "tests/acceptance",
  "e2e",
  "tests/contract",
  "apps/agent-runtime/tests/acceptance",
  // H2a test-plan §9 Q-T1: mock Dify (MK) do backend-lead viết, test H2a phụ thuộc — khoá như test.
  "tools/hub-dev/src/dify-mock.ts",
];

export type LockDiff = { kind: "CHANGED" | "MISSING" | "UNLOCKED"; path: string };

/** sha256 hex sau khi đổi CRLF → LF (hash giống nhau giữa Windows và CI Linux). */
export function hashFile(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildLock(files: { path: string; text: string }[]): string {
  const rows = [...files]
    .sort((a, b) => byPath(a.path, b.path))
    .map((f) => `${hashFile(f.text)}  ${f.path}\n`);
  return `${LOCK_HEADER}\n${rows.join("")}`;
}

export function parseLock(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (m?.[1] && m[2]) out.set(m[2], m[1]);
  }
  return out;
}

export function diffLock(expected: Map<string, string>, actual: Map<string, string>): LockDiff[] {
  const out: LockDiff[] = [];
  const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort(byPath);
  for (const path of paths) {
    const want = expected.get(path);
    const got = actual.get(path);
    if (want === undefined) out.push({ kind: "UNLOCKED", path });
    else if (got === undefined) out.push({ kind: "MISSING", path });
    else if (want !== got) out.push({ kind: "CHANGED", path });
  }
  return out;
}

function lockedFiles(root: string): { path: string; text: string }[] {
  return listFiles(root, LOCKED_DIRS)
    .filter((p) => !p.includes("__pycache__/"))
    .filter((p) => existsSync(join(root, p)))
    .map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
}

function verify(root: string): number {
  const lockFile = join(root, LOCK_PATH);
  if (!existsSync(lockFile)) {
    console.error(`${LOCK_PATH} không tồn tại`);
    return 1;
  }
  const files = lockedFiles(root);
  const actual = new Map(files.map((f) => [f.path, hashFile(f.text)]));
  const diffs = diffLock(parseLock(readFileSync(lockFile, "utf8")), actual);
  for (const d of diffs) console.error(`${d.kind} ${d.path}`);
  if (diffs.length) return 1;
  console.log(`test:lock OK (${files.length} file)`);
  return 0;
}

function write(root: string): number {
  const files = lockedFiles(root);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, LOCK_PATH), buildLock(files));
  console.error("test:lock:write — chỉ qc được chạy lệnh này (WORKFLOW.md, Luật khoá test).");
  console.log(`test:lock: đã ghi ${LOCK_PATH} (${files.length} file)`);
  return 0;
}

function main(argv: string[]): number {
  const mode = argv[0];
  if (mode !== "verify" && mode !== "write") {
    console.error("Dùng: test-lock.ts verify | write");
    return 1;
  }
  const root = repoRoot();
  return mode === "verify" ? verify(root) : write(root);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
