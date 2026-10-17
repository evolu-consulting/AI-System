// CA-R03…R06 · ADR-0023 · spec-ca §1–§2 · test-plan §5 PD-A01…A03: lớp 1 `P/domain` chỉ built-in, lớp 2 `P/application`
// chỉ hướng vào trong; không đọc giờ/ngẫu nhiên/mạng/env; trần dòng theo lớp. Thư mục chưa có ⇒ đỏ ở expect tồn tại.
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { depcruiseBin, runDepcruise } from "../../../../tools/scripts/src/depcruise";
import { PROC, ROOT } from "../_support/modules";

const DOMAIN = `${PROC}/domain`;
const APP = `${PROC}/application`;
const ADAPTERS = `${PROC}/adapters`;
const SLOW = 120_000; // depcruise 1–5 s trên Windows (mẫu tools/scripts/src/depcruise.test.ts)

/** File `.ts` (không `.test.ts`) dưới `rel`, đường dẫn tương đối gốc repo, dấu `/`. */
function srcFiles(rel: string, pattern = "**/*.ts"): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  return [...new Bun.Glob(pattern).scanSync({ cwd: abs })]
    .map((f) => `${rel}/${f.replaceAll("\\", "/")}`)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .sort();
}
const lineCount = (rel: string): number =>
  readFileSync(join(ROOT, rel), "utf8")
    .replace(/\r?\n$/, "")
    .split(/\r?\n/).length;

function expectDirs(...rels: string[]): void {
  expect(Object.fromEntries(rels.map((r) => [r, existsSync(join(ROOT, r))]))).toEqual(
    Object.fromEntries(rels.map((r) => [r, true])),
  );
}

type Violation = { rule: { name: string }; from: string; to: string };

describe("PD-A01 · dependency-cruiser luật ca-* trên P/domain, P/application [CA-R03, ADR-0023]", () => {
  it(
    "CA-R03 · PD-A01 · 0 vi phạm ca-domain-builtin-only / ca-application-inward-only / ca-inner-no-cross-module",
    () => {
      expectDirs(DOMAIN, APP);
      const r = runDepcruise({
        cwd: ROOT,
        targets: [DOMAIN, APP],
        config: join(ROOT, ".dependency-cruiser.cjs"),
        outputType: "json",
        bin: depcruiseBin(ROOT),
      });
      const start = r.out.indexOf("{");
      expect({ json: start >= 0 }).toEqual({ json: true });
      const json = JSON.parse(r.out.slice(start)) as {
        summary: { violations: Violation[]; totalCruised: number };
      };
      expect(json.summary.totalCruised).toBeGreaterThan(0);
      const ca = json.summary.violations
        // depcruise đi theo import ra ngoài ⇒ chỉ xét cạnh xuất phát từ lớp 1–2 của processes
        .filter((v) => v.rule.name.startsWith("ca-"))
        .filter((v) => v.from.startsWith(`${DOMAIN}/`) || v.from.startsWith(`${APP}/`))
        .map((v) => `${v.rule.name}: ${v.from} → ${v.to}`);
      expect(ca).toEqual([]);
    },
    SLOW,
  );
});

/** Mẫu cấm ở lớp 1–2 (CA-R03, CA-R05, CA-R09; plan-domain đầu file). */
const FORBIDDEN: readonly [string, RegExp][] = [
  ["Date.now(", /Date\.now\(/],
  ["new Date()", /new Date\(\s*\)/],
  ["crypto.", /\bcrypto\./],
  ["Math.random(", /Math\.random\(/],
  ["TextEncoder", /\bTextEncoder\b/],
  ["fetch(", /\bfetch\(/],
  ["process.env", /process\.env/],
  ['from "@ai/', /from\s+["']@ai\//],
  ['from "zod"', /from\s+["']zod["']/],
  ['from "node:', /from\s+["']node:/],
];

describe("PD-A02 · quét văn bản lớp 1–2 [CA-R03, CA-R05, CA-R09]", () => {
  it("CA-R05 · PD-A02 · P/domain/**, P/application/** (không .test.ts) không chứa giờ/ngẫu nhiên/mạng/env/import contract-zod-node", () => {
    expectDirs(DOMAIN, APP);
    const files = [...srcFiles(DOMAIN), ...srcFiles(APP)];
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const [label, re] of FORBIDDEN) if (re.test(text)) hits.push(`${f}: ${label}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("PD-A03 · trần dòng theo lớp [spec-ca §2, plan §2]", () => {
  it("CA-R03 · PD-A03 · mỗi file P/domain/** ≤ 150 dòng", () => {
    expectDirs(DOMAIN);
    const files = srcFiles(DOMAIN);
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => [f, lineCount(f)]).filter(([, n]) => (n as number) > 150)).toEqual([]);
  });
  it("CA-R06 · PD-A03 · mỗi P/application/**/*.usecase.ts ≤ 120 dòng", () => {
    expectDirs(APP);
    const files = srcFiles(APP, "**/*.usecase.ts");
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => [f, lineCount(f)]).filter(([, n]) => (n as number) > 120)).toEqual([]);
  });
  it("CA-R06 · PD-A03 · mỗi P/adapters/**/*.repo.ts ≤ 200 dòng", () => {
    expectDirs(ADAPTERS);
    const files = srcFiles(ADAPTERS, "**/*.repo.ts");
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => [f, lineCount(f)]).filter(([, n]) => (n as number) > 200)).toEqual([]);
  });
});
