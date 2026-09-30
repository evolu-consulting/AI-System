import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_helpers";

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
const text = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const doc = Bun.YAML.parse(text) as {
  on?: Record<string, unknown>;
  jobs: Record<string, { steps: Step[] }>;
};
const steps: Step[] = Object.values(doc.jobs).flatMap((j) => j.steps);
const runs = steps.map((s) => s.run ?? "");

describe("ADM-NFR-06 · M0-AC17 · .github/workflows/ci.yml", () => {
  it("ADM-NFR-06 · M0-AC17 · YAML hợp lệ và có ít nhất một job", () => {
    expect(Object.keys(doc.jobs).length).toBeGreaterThan(0);
  });

  it("ADM-NFR-06 · M0-AC17 · dùng bun 1.3.14 (oven-sh/setup-bun)", () => {
    const setup = steps.find((s) => s.uses?.startsWith("oven-sh/setup-bun@"));
    expect(String(setup?.with?.["bun-version"])).toBe("1.3.14");
  });

  it("ADM-NFR-06 · M0-AC17 · đủ 8 step đúng thứ tự (được xen step khác)", () => {
    const order = [
      /\bbun install --frozen-lockfile\b/,
      /\bbun run check(\s|$)/,
      /\bbun run typecheck\b/,
      /\bbun test(\s|$)/,
      /\bbun run db:migrate\b/,
      /\bbun run test:int\b/,
      /\bbun run test:lock:verify\b/,
      /\bbun run trace --check\b/,
    ];
    let from = 0;
    for (const re of order) {
      const at = runs.findIndex((r, i) => i >= from && re.test(r));
      expect(at, `thiếu hoặc sai thứ tự step ${re}`).toBeGreaterThanOrEqual(from);
      from = at + 1;
    }
  });

  it("ADM-NFR-06 · M0-AC17 · chạy trên pull_request và push nhánh main; quyền chỉ đọc", () => {
    const on = (doc.on ?? (doc as unknown as Record<string, Record<string, unknown>>)["true"]) as
      | Record<string, unknown>
      | undefined;
    expect(Object.keys(on ?? {})).toEqual(expect.arrayContaining(["pull_request", "push"]));
    expect(JSON.stringify(on?.push)).toContain("main");
    expect(text).toMatch(/permissions:\s*\n\s+contents:\s*read/);
  });

  it("ADM-NFR-06 · M0-AC17 · có step `git fetch origin main:main` trước install, chỉ chạy khi không ở nhánh main (spec §9 r#7)", () => {
    const at = steps.findIndex((s) => /\bgit fetch origin main:main\b/.test(s.run ?? ""));
    expect(at).toBeGreaterThanOrEqual(0);
    const install = steps.findIndex((s) => /\bbun install --frozen-lockfile\b/.test(s.run ?? ""));
    expect(at).toBeLessThan(install);
    const cond = String((steps[at] as Step & { if?: unknown }).if ?? "");
    expect(cond).toContain("refs/heads/main");
    expect(cond).toContain("!=");
  });

  it("ADM-NFR-06 · M0-AC17 · không chứa secret thật / mật khẩu ngoài giá trị dev", () => {
    expect(text).not.toMatch(/BEGIN (PRIVATE|RSA) KEY/);
  });
});
