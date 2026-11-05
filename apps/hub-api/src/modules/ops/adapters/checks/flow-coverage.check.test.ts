// CR-120 (part F) · unit: đánh giá check `flow_coverage` (thuần, không DB) + dựng danh sách khe cần kiểm.
import { describe, expect, it } from "bun:test";
import {
  type CoverageAgg,
  coverageSlotsOf,
  evaluateFlowCoverage,
  makeFlowCoverageCheck,
} from "./flow-coverage.check";

const gap = (tenant: string, slot = "contracts.approval", effective = true) => ({
  slot,
  tenant,
  effective,
});
const agg = (over: Partial<CoverageAgg>): CoverageAgg => ({
  checked: 3,
  gap_count: 0,
  gaps: [],
  ...over,
});

describe("flow_coverage · evaluateFlowCoverage", () => {
  it("không thiếu ⇒ ok", () => {
    const r = evaluateFlowCoverage(agg({}));
    expect(r.status).toBe("ok");
    expect(r.message).toContain("3 tenant");
  });

  it("không tenant nào bật gói ⇒ ok, nói rõ chưa có gì để kiểm", () => {
    const r = evaluateFlowCoverage(agg({ checked: 0 }));
    expect(r.status).toBe("ok");
    expect(r.message).toContain("Chưa có tenant");
  });

  it("tenant Demo thiếu quy trình hiển thị ⇒ crit, thông điệp có TÊN tenant + khe", () => {
    const r = evaluateFlowCoverage(agg({ gap_count: 1, gaps: [gap("Demo")] }));
    expect(r.status).toBe("crit");
    expect(r.message).toContain("Demo (contracts.approval)");
    expect(r.message).toContain("1/3");
    expect(r.hint).toContain("ensureSlotDefaults");
  });

  it("nhiều tenant ⇒ chỉ nêu 5 tên đầu và 'và N nữa', số thật nằm ở value", () => {
    const gaps = ["A", "B", "C", "D", "E"].map((t) => gap(t));
    const r = evaluateFlowCoverage(agg({ checked: 12, gap_count: 8, gaps }));
    expect(r.status).toBe("crit");
    expect(r.message).toContain("và 3 nữa");
    expect(r.message).not.toContain("F (");
    expect((r.value as { gap_count: number }).gap_count).toBe(8);
  });

  it("không có đường chạy nào (mặc định khe cũng thiếu) ⇒ vẫn crit, không gắn ghi chú 'chưa backfill'", () => {
    const r = evaluateFlowCoverage(
      agg({ gap_count: 1, gaps: [gap("Demo", "contracts.approval", false)] }),
    );
    expect(r.status).toBe("crit");
    expect(r.message).not.toContain("backfill");
  });
});

describe("flow_coverage · feature engine duyệt", () => {
  it("tenant có quy trình duyệt nhưng thiếu feature engine ⇒ crit nêu tên + khoá feature", () => {
    const r = evaluateFlowCoverage(agg({ engine_off: ["NiTi"] }));
    expect(r.status).toBe("crit");
    expect(r.message).toContain("NiTi");
    expect(r.message).toContain("contracts-approval-engine");
    expect(r.hint).toContain("Tính năng");
  });

  it("engine_off rỗng ⇒ không ảnh hưởng", () => {
    expect(evaluateFlowCoverage(agg({ engine_off: [] })).status).toBe("ok");
  });
});

describe("flow_coverage · khe cần kiểm", () => {
  it("bỏ khe dlc.*, feature = <gói>-read", () => {
    const slots = coverageSlotsOf(() => [
      { key: "contracts.approval", packKey: "contracts" },
      { key: "dlc.fast", packKey: "dlc" },
    ]);
    expect(slots).toEqual([{ slot: "contracts.approval", feature: "contracts-read" }]);
  });

  it("chưa có khe nào đăng ký ⇒ ok, không đụng DB", async () => {
    const check = makeFlowCoverageCheck(() => []);
    const r = await check.run(
      { db: null as never, fetch, now: new Date(), signal: new AbortController().signal },
      { enabled: true, warn: null, crit: null },
      {} as never,
    );
    expect(r.status).toBe("ok");
  });
});
