import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildLock, diffLock, hashFile, LOCK_HEADER, parseLock } from "./test-lock";

const SCRIPT = join(import.meta.dir, "test-lock.ts");
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "be-lock-"));
  dirs.push(dir);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

const cli = (dir: string, mode: string) => {
  const p = Bun.spawnSync([process.execPath, SCRIPT, mode], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};

describe("ADM-NFR-06 · test-lock hàm thuần (T-LOCK-1…3)", () => {
  test("hashFile: CRLF = LF", () => {
    expect(hashFile("a\r\nb\r\n")).toBe(hashFile("a\nb\n"));
    expect(hashFile("a")).not.toBe(hashFile("a "));
  });

  test("buildLock: header, sắp theo path, hai dấu cách, \\n cuối; rỗng chỉ header", () => {
    const lock = buildLock([
      { path: "tests/acceptance/b.ts", text: "b" },
      { path: "e2e/a.spec.ts", text: "a" },
    ]);
    expect(lock).toBe(
      `${LOCK_HEADER}\n${hashFile("a")}  e2e/a.spec.ts\n${hashFile("b")}  tests/acceptance/b.ts\n`,
    );
    expect(buildLock([])).toBe(`${LOCK_HEADER}\n`);
  });

  test("parseLock bỏ header/dòng lạ; diffLock ra CHANGED/MISSING/UNLOCKED", () => {
    const h = hashFile("x");
    const expected = parseLock(`${LOCK_HEADER}\n${h}  a\n${h}  b\nrác\n`);
    expect([...expected.keys()]).toEqual(["a", "b"]);
    const actual = new Map([
      ["a", hashFile("khac")],
      ["c", h],
    ]);
    expect(diffLock(expected, actual)).toEqual([
      { kind: "CHANGED", path: "a" },
      { kind: "MISSING", path: "b" },
      { kind: "UNLOCKED", path: "c" },
    ]);
  });
});

describe("ADM-NFR-06 · test-lock CLI", () => {
  test("thiếu lock → exit 1; write rồi verify → OK; sửa file → CHANGED", () => {
    const dir = repo({ "tests/acceptance/X/a.test.ts": "export {};\n", "tests/unit/b.ts": "x" });
    const miss = cli(dir, "verify");
    expect(miss.code).toBe(1);
    expect(miss.out).toContain("tests/.lock không tồn tại");
    expect(cli(dir, "write").code).toBe(0);
    expect(cli(dir, "verify").out).toContain("test:lock OK (1 file)");
    writeFileSync(join(dir, "tests/acceptance/X/a.test.ts"), "export {}; \n");
    const changed = cli(dir, "verify");
    expect(changed.code).toBe(1);
    expect(changed.out).toContain("CHANGED tests/acceptance/X/a.test.ts");
  });

  test("lock rỗng + không file → OK (0 file); chế độ lạ → exit 1", () => {
    const dir = repo({ "README.md": "x" });
    expect(cli(dir, "write").code).toBe(0);
    expect(cli(dir, "verify").out).toContain("test:lock OK (0 file)");
    expect(cli(dir, "khac").code).toBe(1);
  });
});

describe("WRK-NFR-06 · test-lock khoá test Python", () => {
  test("apps/agent-runtime/tests/acceptance được khoá, __pycache__ bị bỏ qua", () => {
    const dir = repo({
      "apps/agent-runtime/tests/acceptance/test_a.py": "def test_x(): ...\n",
      "apps/agent-runtime/tests/acceptance/__pycache__/a.pyc": "bin",
      "apps/agent-runtime/tests/unit/test_b.py": "x\n",
    });
    expect(cli(dir, "write").code).toBe(0);
    const v = cli(dir, "verify");
    expect(v.out).toContain("test:lock OK (1 file)");
  });
});
