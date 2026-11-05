import { describe, expect, it } from "bun:test";
import { parsePhases } from "./evotest-summary";
import { formatSummary, parseLog } from "./evotest-summary.rules";

const INT_OK = `[evotest] slot 1 (evotest-s1)
test:int:par: 1 file / 1 worker (s1), 0 file tuần tự
  ✓ s1: 1 file / 1 lô, 1.8 s
test:int:par: 14 pass, 0 fail, 1.9 s
[evotest] int: exit 0, 16 s
`;
const E2E_RED = `test:e2e:par: làn 1, 2 việc / 2 cùng lúc (a, b)
  ✓ community-web: 12 pass, 40.1 s
  ✗ root: 3 pass, 9.0 s
test:e2e:par: 15 pass, 2 fail, 50.0 s — đỏ: root
test:e2e:par: 1 đỏ MỚI (không nằm trong tests/known-red.json còn hạn):
  NEW [e2e] e2e/root/a.spec.ts › mở trang
  known [e2e] x › y — lý do (o, hạn 2026-11-17)
[evotest] e2e: exit 1, 61 s
`;

describe("evotest-summary · parseLog", () => {
  it("int xanh: pass/fail + thời gian máy chủ", () => {
    const p = parseLog(INT_OK);
    expect([p.pass, p.fail, p.serverS, p.newReds.length]).toEqual([14, 0, 16, 0]);
  });
  it("e2e đỏ: việc, đỏ MỚI, đỏ cũ đếm riêng", () => {
    const p = parseLog(E2E_RED);
    expect(p.jobs.map((j) => [j.name, j.ok])).toEqual([
      ["community-web", true],
      ["root", false],
    ]);
    expect(p.newReds).toEqual(["[e2e] e2e/root/a.spec.ts › mở trang"]);
    expect(p.knownCount).toBe(1);
  });
  it("bước unit (bun test) và lỗi hạ tầng", () => {
    expect(parseLog(" 120 pass\n 2 fail\n")).toMatchObject({ pass: 120, fail: 2 });
    expect(parseLog("bun install lỗi\n").setupError).toBe("bun install lỗi");
  });
});

describe("evotest-summary · formatSummary", () => {
  it("xanh ≤ 15 dòng, có log; đỏ chỉ liệt kê đỏ MỚI (không known)", () => {
    const ok = formatSummary({
      step: "int",
      commit: "abc",
      exit: 0,
      wallS: 41,
      phases: { prep: 2, push: 3 },
      logPath: "/l",
      logs: [INT_OK],
    });
    expect(ok[0]).toContain("XANH");
    expect(ok.join("\n")).toContain("prep 2s · push 3s");
    expect(ok.length).toBeLessThanOrEqual(15);
    const bad = formatSummary({
      step: "e2e",
      commit: "abc",
      exit: 1,
      wallS: 70,
      logPath: "/l",
      logs: [E2E_RED],
    });
    const text = bad.join("\n");
    expect(text).toContain("đỏ MỚI (1)");
    expect(text).toContain("e2e/root/a.spec.ts › mở trang");
    expect(text).not.toContain("lý do");
    expect(bad.length).toBeLessThanOrEqual(15);
  });
  it("nhiều đỏ mới bị cắt gọn", () => {
    const many = Array.from({ length: 30 }, (_, i) => `  NEW [int] f${i}.int.test.ts › ca`).join(
      "\n",
    );
    const l = formatSummary({
      step: "int",
      commit: "c",
      exit: 1,
      wallS: 1,
      logPath: "/l",
      logs: [many],
    });
    expect(l.length).toBeLessThanOrEqual(15);
    expect(l.join("\n")).toContain("+22 ca nữa");
  });
  it("parsePhases", () => {
    expect(parsePhases("a=1,b=2.5,c=x")).toEqual({ a: 1, b: 2.5 });
  });
});
