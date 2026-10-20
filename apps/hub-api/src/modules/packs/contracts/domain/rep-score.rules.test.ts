// V2-E · BA v2 §5.1 (4 bước, bậc thang, ngưỡng, MỚI, trộn sao, điểm vai) — luật thuần.
import { describe, expect, it } from "bun:test";
import {
  cellProblem,
  DEFAULT_JOB_TYPES,
  DEFAULT_SETTINGS,
  defaultCell,
  settingsProblem,
} from "./rep-config.rules";
import {
  ageMonths,
  blend,
  type CellInput,
  cellScore,
  decayAt,
  decayFactor,
  decaySample,
  levelOf,
  milestoneScore,
  monthsBefore,
  roleScore,
} from "./rep-score.rules";

const D = { months: [6, 12], factors: [1, 0.5, 0.2] };
const ctx = (g: "goods" | "service", r: "supplier" | "customer") => ({
  cell: defaultCell(g, r),
  settings: DEFAULT_SETTINGS,
  jobTypes: DEFAULT_JOB_TYPES,
});
const inp = (o: Partial<CellInput>): CellInput => ({
  party: "tax:1",
  role: "supplier",
  grp: "goods",
  sources: {},
  value: 0,
  stars: {},
  ...o,
});

describe("V2-E §5.1 · bước 1–2: điểm việc và độ cũ", () => {
  it("mốc: chỉ lỗi do đối tác trừ 2 điểm/ngày; lỗi mình/chưa rõ = 100; không âm", () => {
    expect(milestoneScore(5, "partner", 2)).toBe(90);
    expect(milestoneScore(5, "ours", 2)).toBe(100);
    expect(milestoneScore(5, "unknown", 2)).toBe(100);
    expect(milestoneScore(5, null, 2)).toBe(100);
    expect(milestoneScore(80, "partner", 2)).toBe(0);
  });
  it("bậc thang < 6 th 100% · 6–12 th 50% · > 12 th 20% (tháng tròn như Postgres age())", () => {
    expect(ageMonths("2026-05-21", "2026-10-20")).toBe(4);
    expect(ageMonths("2026-04-20", "2026-10-20")).toBe(6);
    expect(ageMonths("2026-04-21", "2026-10-20")).toBe(5);
    expect([0, 5, 6, 11, 12, 30].map((a) => decayFactor(a, D))).toEqual([1, 1, 0.5, 0.5, 0.2, 0.2]);
  });
  it("ranh giới bậc theo ngày (≡ SQL): hôm nay − m tháng, kẹp cuối tháng", () => {
    expect(monthsBefore("2026-08-31", 6)).toBe("2026-02-28");
    expect(monthsBefore("2026-10-20", 12)).toBe("2025-10-20");
    expect(monthsBefore("2026-01-15", 13)).toBe("2024-12-15");
    expect(
      ["2026-05-01", "2026-04-20", "2026-04-21", "2025-10-21", "2025-10-20"].map((at) =>
        decayAt(at, "2026-10-20", D),
      ),
    ).toEqual([1, 0.5, 1, 0.5, 0.2]);
  });
  it("mẫu 3 việc (2/8/14 tháng, 100/80/60) theo bậc thang mặc định", () => {
    const s = decaySample(D);
    expect(s.jobs.map((j) => j.h)).toEqual([1, 0.5, 0.2]);
    expect(s.criterion_score).toBe(Math.round(((100 + 40 + 12) / 1.7) * 10) / 10);
  });
});

describe("V2-E §5.1 · bước 3–4: dữ liệu, sao, mức", () => {
  it("điểm dữ liệu bỏ tiêu chí chưa có dữ liệu (NCC hàng hoá: chỉ Giao đúng hạn có số)", () => {
    // 3 mốc giao, h = 1, 1, 0.5; điểm 100, 90, 60 ⇒ (100 + 90 + 30) / 2.5 = 88
    const c = cellScore(
      inp({ sources: { "m:delivery": { n: 3, wh: 2.5, whs: 220 } } }),
      ctx("goods", "supplier"),
    );
    expect([c.data_score, c.score, c.level, c.jobs]).toEqual([88, 88, "good", 3]);
    expect(c.criteria.find((x) => x.key === "quality")?.score).toBeNull();
  });
  it("trọng số w giữa các tiêu chí có dữ liệu + việc ghi tay theo loại việc", () => {
    const c = cellScore(
      inp({
        sources: {
          "m:delivery": { n: 2, wh: 2, whs: 200 }, // 100
          "j:quality_ok": { n: 1, wh: 1, whs: 0 },
          "j:quality_bad": { n: 1, wh: 1, whs: 0 }, // (100 + 30) / 2 = 65
        },
      }),
      ctx("goods", "supplier"),
    );
    // Giao 35%·100 + Chất lượng 35%·65 trên 70% ⇒ 82.5 ⇒ 83 (KHÁ)
    expect([c.data_score, c.level]).toEqual([83, "fair"]);
  });
  it("đếm việc xấu: 100 − mức trừ × số lần / 10 giao dịch", () => {
    const c = cellScore(
      inp({
        role: "customer",
        sources: {
          "m:payment": { n: 10, wh: 10, whs: 1000 },
          "j:complaint": { n: 2, wh: 2, whs: 0 },
        },
      }),
      ctx("goods", "customer"),
    );
    expect(c.criteria.find((x) => x.key === "complaints")?.score).toBe(80);
  });
  it("sao: (1 − s)·dữ liệu + s·sao×20; chưa có dữ liệu ⇒ sao×20; chưa có sao ⇒ dữ liệu", () => {
    expect(blend(90, 3, 20)).toBeCloseTo(84);
    expect(blend(null, 4, 20)).toBe(80);
    expect(blend(70, null, 20)).toBe(70);
  });
  it("ngưỡng 85/70; dưới 3 việc ⇒ MỚI", () => {
    expect(levelOf(85, 3, DEFAULT_SETTINGS)).toBe("good");
    expect(levelOf(84, 3, DEFAULT_SETTINGS)).toBe("fair");
    expect(levelOf(69, 3, DEFAULT_SETTINGS)).toBe("watch");
    expect(levelOf(99, 2, DEFAULT_SETTINGS)).toBe("new");
  });
  it("điểm vai = bình quân điểm nhóm theo giá trị giao dịch; giá trị 0 ⇒ bình quân đều", () => {
    const a = {
      ...cellScore(
        inp({ sources: { "m:delivery": { n: 3, wh: 3, whs: 300 } } }),
        ctx("goods", "supplier"),
      ),
      value: 300,
    };
    const b = {
      ...cellScore(
        inp({ grp: "service", sources: { "m:delivery": { n: 3, wh: 3, whs: 150 } } }),
        ctx("service", "supplier"),
      ),
      value: 100,
    };
    expect(roleScore([a, b], DEFAULT_SETTINGS)).toEqual({ score: 88, level: "good", jobs: 6 });
    expect(
      roleScore(
        [
          { ...a, value: 0 },
          { ...b, value: 0 },
        ],
        DEFAULT_SETTINGS,
      ).score,
    ).toBe(75);
  });
});

describe("V2-E CD-02..05 · kiểm cấu hình", () => {
  it("mặc định BA hợp lệ, tổng 100", () => {
    for (const [g, r] of [
      ["service", "supplier"],
      ["service", "customer"],
      ["goods", "supplier"],
      ["goods", "customer"],
      ["referral", "commission_payer"],
    ] as const)
      expect(cellProblem(defaultCell(g, r))).toBeNull();
    expect(defaultCell("service", "customer").window_months).toBe(24);
    expect(defaultCell("goods", "customer").window_months).toBe(12);
    expect(settingsProblem(DEFAULT_SETTINGS)).toBeNull();
  });
  it("lỗi: tổng ≠ 100, > 8 tự thêm, đổi kiểu tiêu chí có sẵn, bậc thang sai, s > 50", () => {
    const c = defaultCell("goods", "supplier");
    expect(
      cellProblem({
        ...c,
        criteria: c.criteria.map((x, i) => (i ? x : { ...x, weight: x.weight + 1 })),
      }),
    ).toBe("Tổng trọng số tiêu chí bật phải đúng 100%");
    const customs = Array.from({ length: 9 }, (_, i) => ({
      key: `custom:c${i}`,
      label: `C${i}`,
      kind: "manual" as const,
      weight: 0,
      enabled: false,
      custom: true,
    }));
    expect(cellProblem({ ...c, criteria: [...c.criteria, ...customs] })).toBe(
      "Tối đa 8 tiêu chí tự thêm",
    );
    expect(
      cellProblem({
        ...c,
        criteria: c.criteria.map((x, i) => (i ? x : { ...x, kind: "manual" as const })),
      }),
    ).toContain("không đổi kiểu");
    expect(cellProblem({ ...c, decay: { months: [12, 6], factors: [1, 0.5, 0.2] } })).toBe(
      "Mốc tháng tăng dần, trong khoảng tính điểm",
    );
    expect(settingsProblem({ ...DEFAULT_SETTINGS, manual_share: 51 })).toBe(
      "Tỷ trọng đánh giá thủ công 0–50%",
    );
    expect(settingsProblem({ ...DEFAULT_SETTINGS, fair_from: 85 })).toBe(
      "Ngưỡng: 0 ≤ KHÁ < TỐT ≤ 100",
    );
  });
});
