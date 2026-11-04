// REP-v3-ui · V2-E · luật thuần cấu hình điểm uy tín: chuẩn hoá trọng số, so mặc định/đã lưu, kiểm sơ bộ, thân PUT, thử tính, ô → thân API.
import { describe, expect, test } from "bun:test";
import {
  buildRep,
  cellBody,
  cellIssue,
  firstRepIssue,
  normalise,
  percentOf,
  repAnyChanged,
  repChangedParts,
  slugKey,
} from "./rep-data";
import type { Cell, CellKey, RepConfigFull } from "./rep-types";
import { criterionFromJobs, decayAt, levelOf, needsReason, tryCriteria } from "./try-calc";

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
const KEYS: CellKey[] = [
  "service:supplier",
  "service:customer",
  "goods:supplier",
  "goods:customer",
  "referral:commission_payer",
];
const rep = (): RepConfigFull => {
  const cells = Object.fromEntries(KEYS.map((k) => [k, cell()])) as Record<CellKey, Cell>;
  const s = {
    good_from: 85,
    fair_from: 70,
    min_jobs: 3,
    manual_share: 20,
    reason_gap: 25,
    lock_period: "month" as const,
  };
  return {
    engine: "v2e",
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

describe("V2-E · dữ liệu cấu hình", () => {
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
  test("5 ô nhóm × vai; đổi trọng số một ô ⇒ chỉ ô đó khác mặc định; khôi phục ⇒ không đổi", () => {
    const s = buildRep(rep());
    expect(Object.keys(s.saved.cells)).toEqual(KEYS);
    expect(repAnyChanged(repChangedParts(s.saved, s.defaults))).toBe(false);
    const d = structuredClone(s.saved);
    (d.cells["goods:supplier"].criteria[0] as { weight: number }).weight = 10;
    d.repSettings.good_from = 90;
    expect(repChangedParts(d, s.defaults)).toEqual({
      cells: ["goods:supplier"],
      settings: true,
      jobTypes: false,
    });
  });
  test("thân PUT ô: bỏ `custom`, trọng số tổng 100; lỗi sơ bộ; mức 85/70 phải KHÁ < TỐT", () => {
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
    const s = buildRep(rep());
    const d = structuredClone(s.saved);
    d.repSettings.fair_from = 90;
    expect(firstRepIssue(d, repChangedParts(d, s.saved))).toBe("common.order");
    expect(s.saved.repSettings).toMatchObject({ good_from: 85, fair_from: 70 });
  });
  test("khoá tiêu chí tự thêm: không dấu, duy nhất trong ô", () => {
    expect(slugKey("Đúng hạn giao", [])).toBe("custom:dung-han-giao");
    expect(slugKey("A", ["custom:a"])).toBe("custom:a-2");
  });
});

describe("V2-E · thử tính", () => {
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
