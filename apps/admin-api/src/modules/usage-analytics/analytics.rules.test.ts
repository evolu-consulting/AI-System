// ADM-FR-42 · usage-analytics · luật thuần: tier model, xô ngày/tuần/tháng, khoảng trước, mặt nạ GROUPING SETS, gộp tier,
// top-N, con trỏ bản ghi, cột CSV theo role.
import { describe, expect, test } from "bun:test";
import {
  addMeasures,
  bucketOf,
  bucketsOf,
  decodeCursor,
  encodeCursor,
  errorRate,
  maskOf,
  measuresOf,
  modelTier,
  normMoney,
  previousFrom,
  recordColumns,
  setOf,
  sortTop,
  tiersOf,
  ZERO_MEASURES,
} from "./analytics.rules";

const m = (o: Partial<typeof ZERO_MEASURES> = {}) => ({ ...ZERO_MEASURES, ...o });

describe("ADM-FR-42 · usage-analytics rules", () => {
  test("modelTier theo tên model", () => {
    expect(
      ["claude-opus-5-5", "claude-sonnet-5-5", "Claude-Haiku-5-5", "gpt-5", "llama", null].map(
        modelTier,
      ),
    ).toEqual(["opus", "sonnet", "haiku", "openai", "other", "unknown"]);
  });

  test("xô: ngày giữ nguyên; tuần = thứ Hai ISO; tháng = ngày 1", () => {
    expect(bucketOf("2026-10-21", "day")).toBe("2026-10-21");
    expect(bucketOf("2026-10-21", "week")).toBe("2026-10-19"); // thứ Tư → thứ Hai
    expect(bucketOf("2026-10-25", "week")).toBe("2026-10-19"); // Chủ nhật → thứ Hai trước
    expect(bucketOf("2026-10-21", "month")).toBe("2026-10-01");
    expect(bucketsOf("2026-10-01", "2026-10-03", "day")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(bucketsOf("2026-09-28", "2026-10-12", "week")).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ]);
    expect(bucketsOf("2026-01-15", "2026-03-02", "month")).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });

  test("khoảng trước cùng số ngày", () => {
    expect(previousFrom("2026-10-01", "2026-10-31")).toBe("2026-08-31");
    expect(previousFrom("2026-10-21", "2026-10-21")).toBe("2026-10-20");
  });
});

describe("ADM-FR-42 · usage-analytics rules · gộp", () => {
  test("mặt nạ grouping → tập; cây app/agent/feature/model; mặt nạ lạ → null", () => {
    expect(setOf(maskOf(["app"]))).toBe("app");
    expect(setOf(maskOf(["tenant_id"]))).toBe("tenant_id");
    expect(setOf(maskOf(["app", "agent_id", "feature", "model"]))).toBe("tree");
    expect(maskOf(["outcome"])).toBe(0b111110);
    expect(setOf(0)).toBeNull();
  });

  test("số đo: token = in + out; tiền chuẩn hoá, âm → 0; cộng theo micro-USD", () => {
    const a = measuresOf({
      input_tokens: "100",
      output_tokens: "40",
      cache_tokens: "10",
      calls: "3",
      runs: "2",
      errors: "1",
      cost_usd: "0.100000",
    });
    expect(a).toEqual({
      ...m({ input_tokens: 100, output_tokens: 40, cache_tokens: 10 }),
      tokens: 140,
      calls: 3,
      runs: 2,
      errors: 1,
      cost_usd: "0.1",
    });
    expect(normMoney("-0.000001")).toBe("0");
    expect(addMeasures(m({ cost_usd: "0.1" }), m({ cost_usd: "0.2" })).cost_usd).toBe("0.3");
    expect(errorRate({ errors: 1, calls: 4 })).toBe(0.25);
    expect(errorRate({ errors: 0, calls: 0 })).toBe(0);
  });
});

describe("ADM-FR-42 · usage-analytics rules · top, con trỏ, CSV", () => {
  test("gộp tier từ breakdown model; top-N giảm theo token, khoá null cuối", () => {
    const rows = [
      { key: "claude-opus-5-5", label: null, ...m({ tokens: 10, calls: 1 }) },
      { key: "claude-opus-4", label: null, ...m({ tokens: 5, calls: 1 }) },
      { key: "claude-haiku-5-5", label: null, ...m({ tokens: 30, calls: 2 }) },
      { key: null, label: null, ...m({ tokens: 30, calls: 2 }) },
    ];
    expect(tiersOf(rows).map((r) => [r.key, r.tokens])).toEqual([
      ["haiku", 30],
      ["unknown", 30],
      ["opus", 15],
    ]);
    expect(sortTop(rows, 2).map((r) => r.key)).toEqual(["claude-haiku-5-5", null]);
  });

  test("con trỏ khứ hồi; hỏng → invalid", () => {
    const at = "2026-10-21T03:04:05.123456Z";
    const id = "a3000000-0000-4000-8000-000000000001";
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ at, id });
    expect(decodeCursor("xx")).toBe("invalid");
    expect(decodeCursor(encodeCursor("nope", id))).toBe("invalid");
  });

  test("cột CSV: chỉ platform có cost_usd", () => {
    expect(recordColumns(true)).toContain("cost_usd");
    expect(recordColumns(false)).not.toContain("cost_usd");
  });
});
