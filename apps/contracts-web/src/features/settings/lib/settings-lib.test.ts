// V2-L · luật thuần của hộp thoại Cài đặt: chuẩn hoá trọng số, so mặc định/đã lưu, kiểm sơ bộ, thân PUT, thử tính, CSS màu.
import { describe, expect, test } from "bun:test";
import { brandCss, effectiveTheme } from "./brand";
import {
  anyChanged,
  buildState,
  cellBody,
  cellIssue,
  changedParts,
  normalise,
  percentOf,
} from "./data";
import { criterionFromJobs, decayAt, levelOf, needsReason, tryCriteria } from "./try-calc";
import type { Cell, CellKey, RepConfigOut } from "./types";

const crit = (key: string, weight: number, enabled = true) => ({
  key,
  label: key,
  kind: "ontime" as const,
  milestone: "delivery" as const,
  weight,
  enabled,
  custom: false,
});
const cell = (): Cell => ({
  criteria: [crit("a", 50), crit("b", 30), crit("c", 20)],
  window_months: 12,
  decay: { months: [6], factors: [1, 0.5] },
  late_per_day: 2,
});
const rep = (): RepConfigOut => {
  const cells = Object.fromEntries(
    [
      "service:supplier",
      "service:customer",
      "goods:supplier",
      "goods:customer",
      "referral:commission_payer",
    ].map((k) => [k, cell()]),
  ) as Record<CellKey, Cell>;
  const s = {
    good_from: 85,
    fair_from: 70,
    min_jobs: 3,
    manual_share: 20,
    reason_gap: 25,
    lock_period: "month" as const,
  };
  return {
    cells,
    settings: s,
    job_types: [{ key: "x", name: "X", criterion: "a", score: 0, ord: 0 }],
    versions: {},
    defaults: {
      cells: structuredClone(cells),
      settings: { ...s },
      job_types: [{ key: "x", name: "X", criterion: "a", score: 0, ord: 0 }],
    },
  };
};
const biz = {
  w: { rot: 40, margin: 35, trend: 25 },
  buyDays: 45,
  dumpDays: 150,
  quotaBuy: 120,
  quotaDump: 70,
  hi: 70,
  lo: 45,
  vol: 6,
  soon: 60,
};
const co = {
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo" as const,
  theme: "auto" as const,
  own_names: [] as string[],
  own_tax_ids: [] as string[],
};
const state = () =>
  buildState(
    {
      company: co,
      approval_enabled: true,
      defaults: { ...co, approval_enabled: true },
      version: 0,
      updated_at: null,
    },
    rep(),
    { config: biz, defaults: biz, version: 0, updated_at: null },
  );

describe("V2-L · dữ liệu cài đặt", () => {
  test("normalise: tổng đúng 100, phần dư lớn nhất trước", () => {
    expect(normalise([1, 1, 1])).toEqual([34, 33, 33]);
    expect(normalise([50, 30, 20])).toEqual([50, 30, 20]);
    expect(normalise([25, 25, 25, 25, 25]).reduce((a, b) => a + b, 0)).toBe(100);
  });
  test("tiêu chí tắt không tính vào %", () => {
    const c = cell();
    c.criteria[2] = crit("c", 20, false);
    expect(percentOf(c)).toEqual({ a: 63, b: 37, c: 0 });
  });
  test("đổi trọng số/tắt tiêu chí ⇒ ô khác mặc định; khôi phục ⇒ không đổi", () => {
    const s = state();
    expect(anyChanged(changedParts(s.saved, s.defaults))).toBe(false);
    const d = structuredClone(s.saved);
    (d.cells["goods:supplier"].criteria[0] as { weight: number }).weight = 10;
    d.biz.hi = 80;
    expect(changedParts(d, s.defaults)).toMatchObject({
      cells: ["goods:supplier"],
      biz: true,
      company: false,
      settings: false,
    });
  });
  test("thân PUT ô: bỏ `custom`, trọng số tổng 100; lỗi sơ bộ", () => {
    const c = cell();
    (c.criteria[0] as { weight: number }).weight = 100;
    const b = cellBody(c);
    expect(b.criteria.reduce((a, x) => a + x.weight, 0)).toBe(100);
    expect("custom" in (b.criteria[0] as object)).toBe(false);
    expect(cellIssue({ ...cell(), decay: { months: [20], factors: [1, 0.5] } })).toBe(
      "cell.decayMonths",
    );
    expect(cellIssue({ ...cell(), criteria: [crit("a", 50, false)] })).toBe("cell.needOne");
    expect(cellIssue(cell())).toBeNull();
  });
});

describe("V2-L · thử tính", () => {
  test("hệ số độ cũ theo bậc thang; ngoài khoảng = 0", () => {
    const c = cell();
    expect([decayAt(2, c), decayAt(8, c), decayAt(12, c)]).toEqual([1, 0.5, 0]);
    expect(
      criterionFromJobs(
        [
          { age: 2, score: 100 },
          { age: 8, score: 40 },
        ],
        c,
      ),
    ).toBeCloseTo(80);
    expect(criterionFromJobs([{ age: 20, score: 10 }], c)).toBeNull();
  });
  test("điểm cuối = 80% dữ liệu + 20% sao × 20; lệch quá ngưỡng ⇒ cần lý do; mức", () => {
    const r = tryCriteria(cell(), { a: 100, b: 50, c: 0 }, 20, 4);
    expect(r.data).toBeCloseTo(65);
    expect(r.final).toBe(Math.round(0.8 * 65 + 0.2 * 80));
    expect(tryCriteria(cell(), { a: 100, b: 50, c: 0 }, 20, 0).final).toBe(65);
    expect(needsReason(65, 5, 25)).toBe(true);
    expect([levelOf(90, 85, 70), levelOf(75, 85, 70), levelOf(10, 85, 70)]).toEqual([
      "good",
      "fair",
      "watch",
    ]);
  });
});

describe("V2-L · nhận diện", () => {
  test("chàm = không đè; màu khác đè cả sáng và tối", () => {
    expect(brandCss("indigo")).toBe("");
    const css = brandCss("teal");
    expect(css).toContain("--primary:#0d9488");
    expect(css).toContain("--primary:#2dd4bf");
  });
  test("giao diện: xem thử > riêng > công ty", () => {
    const b = { name: null, app_name: null, logo: null, accent: "indigo", theme: "dark" } as const;
    expect([
      effectiveTheme(b, true, "light"),
      effectiveTheme(b, false, "light"),
      effectiveTheme(b, false, null),
    ]).toEqual(["dark", "light", "dark"]);
  });
});
