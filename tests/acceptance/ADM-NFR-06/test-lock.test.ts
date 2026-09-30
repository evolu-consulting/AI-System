import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, removeRepo, run, scriptPath, writeFiles } from "./_helpers";

const HEADER = "# tests/.lock — sinh bởi bun run test:lock:write (chỉ qc). Không sửa tay.";
const A = "tests/acceptance/A/a.test.ts";
const E = "e2e/s.spec.ts";
const sha = (t: string) => createHash("sha256").update(t.replace(/\r\n/g, "\n")).digest("hex");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeRepo(dirs.pop() as string);
});

const lock = (dir: string, mode: "verify" | "write") =>
  run(["bun", scriptPath("test-lock.ts"), mode], dir);

function lockedRepo(extra: Record<string, string> = {}): string {
  const dir = makeRepo({
    [A]: 'import { it } from "bun:test";\nit("ADM-NFR-06 · x", () => {});\n',
    [E]: 'import { test } from "@playwright/test";\ntest("ADM-NFR-06 · y", () => {});\n',
    ...extra,
  });
  dirs.push(dir);
  expect(lock(dir, "write").code).toBe(0);
  return dir;
}

describe("ADM-NFR-06 · M0-AC13 · test:lock (T-LOCK-1..3)", () => {
  it("ADM-NFR-06 · M0-AC13 · write ghi đúng định dạng: header, sha256, hai dấu cách, path tăng dần, \\n cuối", () => {
    const dir = lockedRepo();
    const text = readFileSync(join(dir, "tests/.lock"), "utf8");
    const expected =
      `${HEADER}\n` +
      `${sha(readFileSync(join(dir, E), "utf8"))}  ${E}\n` +
      `${sha(readFileSync(join(dir, A), "utf8"))}  ${A}\n`;
    expect(text).toBe(expected);
  });

  it("ADM-NFR-06 · M0-AC13 · verify khi khớp → exit 0, test:lock OK (2 file)", () => {
    const dir = lockedRepo();
    const r = lock(dir, "verify");
    expect(r.code).toBe(0);
    expect(r.out).toContain("test:lock OK (2 file)");
  });

  it("ADM-NFR-06 · M0-AC13 · sửa 1 byte file khoá → exit 1, CHANGED <path>", () => {
    const dir = lockedRepo();
    writeFileSync(join(dir, A), `${readFileSync(join(dir, A), "utf8")} `);
    const r = lock(dir, "verify");
    expect(r.code).toBe(1);
    expect(r.out).toContain(`CHANGED ${A}`);
    expect(r.out).not.toContain(`CHANGED ${E}`);
  });

  it("ADM-NFR-06 · M0-AC13 · xoá file khoá → MISSING <path>", () => {
    const dir = lockedRepo();
    rmSync(join(dir, E));
    const r = lock(dir, "verify");
    expect(r.code).toBe(1);
    expect(r.out).toContain(`MISSING ${E}`);
  });

  it("ADM-NFR-06 · M0-AC13 · thêm file test mới chưa khoá → UNLOCKED <path>", () => {
    const dir = lockedRepo();
    writeFiles(dir, { "tests/acceptance/A/b.test.ts": "export {};\n" });
    const r = lock(dir, "verify");
    expect(r.code).toBe(1);
    expect(r.out).toContain("UNLOCKED tests/acceptance/A/b.test.ts");
  });

  it("ADM-NFR-06 · M0-AC13 · đổi \\n thành \\r\\n không làm đổi hash", () => {
    const dir = lockedRepo();
    const text = readFileSync(join(dir, A), "utf8");
    writeFileSync(join(dir, A), text.replace(/\n/g, "\r\n"));
    const r = lock(dir, "verify");
    expect(r.code).toBe(0);
    expect(r.out).toContain("test:lock OK (2 file)");
  });

  it("ADM-NFR-06 · M0-AC13 · file bị .gitignore không nằm trong tập khoá", () => {
    const dir = makeRepo({
      [A]: "export {};\n",
      ".gitignore": "e2e/out.spec.ts\n",
      "e2e/out.spec.ts": "x\n",
    });
    dirs.push(dir);
    expect(lock(dir, "write").code).toBe(0);
    const r = lock(dir, "verify");
    expect(r.code).toBe(0);
    expect(r.out).toContain("test:lock OK (1 file)");
  });

  it("ADM-NFR-06 · M0-AC13 · thiếu tests/.lock → exit 1, 'tests/.lock không tồn tại'", () => {
    const dir = makeRepo({ [A]: "export {};\n" });
    dirs.push(dir);
    const r = lock(dir, "verify");
    expect(r.code).toBe(1);
    expect(r.out).toContain("tests/.lock không tồn tại");
  });

  it("ADM-NFR-06 · M0-AC13 · tập rỗng: lock chỉ có dòng đầu, verify OK (0 file)", () => {
    const dir = makeRepo({ "README.md": "x\n" });
    dirs.push(dir);
    expect(lock(dir, "write").code).toBe(0);
    expect(readFileSync(join(dir, "tests/.lock"), "utf8")).toBe(`${HEADER}\n`);
    const r = lock(dir, "verify");
    expect(r.code).toBe(0);
    expect(r.out).toContain("test:lock OK (0 file)");
  });
});
