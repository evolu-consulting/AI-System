// X1-AC18 · X1-R01 · X1-R03 · X1-R04 · quét tĩnh repo (test-plan §2 AC18): không chuỗi giống key Dify, không lời gọi
// console API trong code/test, script seed không mặc định đường dẫn auto-pilot, không dotenv, không gán process.env.
// Mẫu regex GHÉP CHUỖI lúc chạy để file này không tự khớp. Đỏ (ca seed) tới khi S1 có `seed-dify-live*.ts`.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_modules";

/** File đã khoá của mốc trước chứa key giả cài sẵn (không phải key thật) — không sửa được ở X1 (luật khoá test). */
const KEY_ALLOW = new Set<string>(["tests/acceptance/H3b/_h3b-trace.ts"]);
const KEY_RE = new RegExp(["app", "-[A-Za-z0-9]{20,}"].join(""));
const CONSOLE = ["/con", "sole/api"].join("");
const CODE_DIRS = ["apps/", "packages/", "tools/", "tests/", "e2e/"];
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|lockb|docx|xlsx|pptx)$/i;

function tracked(): string[] {
  const p = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT });
  expect(p.exitCode).toBe(0);
  return p.stdout
    .toString()
    .split("\0")
    .filter((f) => f && !BINARY.test(f));
}
function read(f: string): string {
  try {
    return readFileSync(join(ROOT, f), "utf8");
  } catch {
    return ""; // file đã xoá khỏi working tree nhưng còn trong index
  }
}

describe("X1-AC18 · quét tĩnh", () => {
  it("X1-AC18 · X1-R04 · không file tracked nào chứa chuỗi giống key Dify (app-…20+ ký tự)", () => {
    const hits = tracked().filter((f) => !KEY_ALLOW.has(f) && KEY_RE.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("X1-AC18 · X1-R01 · apps/packages/tools/tests/e2e không chứa đường console API (docs được nhắc luật)", () => {
    const hits = tracked().filter(
      (f) => CODE_DIRS.some((d) => f.startsWith(d)) && read(f).includes(CONSOLE),
    );
    expect(hits).toEqual([]);
  });

  it("X1-AC18 · X1-R03 · tools/scripts/src/seed-dify-live*.ts tồn tại; không auto-pilot/evoluconsulting, không dotenv, không gán process.env", () => {
    const g = new Bun.Glob("tools/scripts/src/seed-dify-live*.ts");
    const files = [...g.scanSync({ cwd: ROOT })].map((f) => f.replace(/\\/g, "/"));
    expect(files).toContain("tools/scripts/src/seed-dify-live.ts");
    const bad: string[] = [];
    for (const f of files) {
      const s = read(f);
      if (/auto-pilot|evoluconsulting/i.test(s)) bad.push(`${f}: đường dẫn auto-pilot`);
      if (/\bdotenv\b/.test(s)) bad.push(`${f}: dotenv`);
      if (/process\.env\s*\[[^\]]+\]\s*=(?!=)|process\.env\.[A-Za-z_]+\s*=(?!=)/.test(s))
        bad.push(`${f}: gán process.env`);
      if (s.includes(CONSOLE)) bad.push(`${f}: console API`);
    }
    expect(bad).toEqual([]);
  });
});
