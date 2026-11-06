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

describe("flow_coverage · cấu hình duyệt HĐ nửa vời (CR-121 D-4)", () => {
  it("gỡ gán giữa chừng (còn lượt duyệt) ⇒ crit nêu tên công ty + cách sửa, không nhắc feature", () => {
    const r = evaluateFlowCoverage(agg({ unrouted: ["NiTi"] }));
    expect(r.status).toBe("crit");
    expect(r.message).toContain("NiTi");
    expect(r.message).toContain("không còn quy trình gán");
    expect(r.hint).toContain("Admin › Công ty › Quy trình");
    expect(`${r.message} ${r.hint}`).not.toContain("contracts-approval-engine");
  });

  it("quy trình đã gán không chạy được / lượt kẹt ⇒ crit nêu tên", () => {
    const r = evaluateFlowCoverage(agg({ broken: ["Demo"] }));
    expect(r.status).toBe("crit");
    expect(r.message).toContain("Demo");
    expect(r.message).toContain("không chạy được");
  });

  it("danh sách rỗng ⇒ không ảnh hưởng; có cả lệch hiển thị ⇒ nối thông điệp", () => {
    expect(evaluateFlowCoverage(agg({ unrouted: [], broken: [] })).status).toBe("ok");
    const r = evaluateFlowCoverage(agg({ unrouted: ["A"], gap_count: 1, gaps: [gap("Demo")] }));
    expect(r.message).toContain("Demo (contracts.approval)");
    expect(r.hint).toContain("ensureSlotDefaults");
  });
});

describe("flow_coverage · danh mục feature lệch (CR-121 c18)", () => {
  it("feature engine còn sót ⇒ crit nêu cách sửa", () => {
    const r = evaluateFlowCoverage(agg({ engine_feature: true }));
    expect(r.status).toBe("crit");
    expect(r.message).toContain("contracts-approval-engine");
    expect(r.hint).toContain("0037");
  });

  it("feature thiếu app (cột app = other dù khoá thuộc một ứng dụng) ⇒ crit nêu key, kèm lệch hiển thị khi có", () => {
    const r = evaluateFlowCoverage(
      agg({ feature_app_missing: ["contracts-odd"], gap_count: 1, gaps: [gap("Demo")] }),
    );
    expect(r.status).toBe("crit");
    expect(r.message).toContain("contracts-odd");
    expect(r.message).toContain("chưa gán ứng dụng");
    expect(r.message).toContain("Demo (contracts.approval)");
    expect((r.value as { feature_app_missing: string[] }).feature_app_missing).toEqual([
      "contracts-odd",
    ]);
  });

  it("danh mục sạch ⇒ không ảnh hưởng", () => {
    expect(
      evaluateFlowCoverage(agg({ engine_feature: false, feature_app_missing: [] })).status,
    ).toBe("ok");
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
