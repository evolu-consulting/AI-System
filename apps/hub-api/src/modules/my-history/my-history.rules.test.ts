// my-activity-rag · unit luật thuần: tham số, hạn lưu, dựng tsquery tiếng Việt (an toàn ghép chuỗi), đoạn trích, gộp, link.
import { describe, expect, it } from "bun:test";
import {
  actionPattern,
  chatLink,
  compactDetail,
  dateArg,
  foldVi,
  keywords,
  limitOf,
  localDate,
  mergeActivity,
  objectOf,
  rangeOf,
  recordLink,
  recordRef,
  retentionMonths,
  rolesOf,
  snippet,
  tsQueryOf,
} from "./my-history.rules";

describe("tham số", () => {
  it("limit / ngày / khoảng / vai / đối tượng", () => {
    expect([
      limitOf(undefined, 8, 20),
      limitOf(99, 8, 20),
      limitOf(0, 8, 20),
      limitOf("3", 8, 20),
    ]).toEqual([8, 20, 8, 3]);
    expect([
      dateArg("2026-10-21"),
      dateArg("2026-02-30"),
      dateArg("21/10/2026"),
      dateArg(5),
    ]).toEqual(["2026-10-21", null, null, null]);
    expect(rangeOf("2026-10-21", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-21" });
    expect(rolesOf("user")).toEqual(["user"]);
    expect(rolesOf("x")).toEqual(["user", "assistant"]);
    expect([objectOf("partner"), objectOf("hack")]).toEqual(["partner", "all"]);
    expect(localDate(new Date("2026-10-21T18:30:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-22");
  });

  it("hạn lưu: mặc định 12, 1–120, sai ⇒ 12", () => {
    expect([
      retentionMonths(null),
      retentionMonths("6"),
      retentionMonths(500),
      retentionMonths(-1),
    ]).toEqual([12, 6, 120, 12]);
    expect([retentionMonths("abc"), retentionMonths(2.5), retentionMonths(24)]).toEqual([
      12, 12, 24,
    ]);
  });

  it("loại thao tác chỉ [a-z_] (không ký tự LIKE/SQL); tham chiếu HĐ: uuid ⇒ id, khác ⇒ số", () => {
    expect(actionPattern("Field_Changed")).toBe("%field_changed%");
    expect(actionPattern("%'; drop--")).toBe("%drop%");
    expect(actionPattern("  ")).toBeNull();
    expect(recordRef("2023/12-MP")).toEqual({ id: null, number: "2023/12-MP" });
    expect(recordRef("7E5D0000-0000-4000-8000-0000000001A1")).toEqual({
      id: "7e5d0000-0000-4000-8000-0000000001a1",
      number: null,
    });
    expect(recordRef("   ")).toBeNull();
  });
});

describe("tìm tiếng Việt", () => {
  it("gấp dấu giữ độ dài; từ khoá bỏ hư từ, bỏ dấu, chỉ [a-z0-9]", () => {
    const s = "Hạn mức ĐỀ NGHỊ";
    expect(foldVi(s)).toBe("han muc de nghi");
    expect(foldVi(s).length).toBe(s.length);
    expect(keywords("Lần trước tôi hỏi gì về hạn mức duyệt?")).toEqual(["han", "muc", "duyet"]);
    expect(keywords("Hôm nay tôi đã hỏi AI những gì?")).toEqual([]);
    expect(keywords("x' | !y & (z) <-> ma1234")).toEqual(["ma1234"]);
  });

  it("tsquery: ≤ 2 từ AND, nhiều hơn OR, không từ ⇒ null", () => {
    expect(tsQueryOf(["han", "muc"])).toBe("han & muc");
    expect(tsQueryOf(["han", "muc", "duyet"])).toBe("han | muc | duyet");
    expect(tsQueryOf([])).toBeNull();
  });

  it("đoạn trích quanh lần khớp đầu tiên, có dấu …", () => {
    const long = `${"mở đầu ".repeat(60)}hạn mức duyệt là 500 triệu ${"kết thúc ".repeat(60)}`;
    const s = snippet(long, ["han", "muc"], 100);
    expect(s).toContain("hạn mức duyệt");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(snippet("ngắn  gọn", ["x"])).toBe("ngắn gọn");
  });
});

describe("gộp + link", () => {
  it("mới nhất trước, cắt limit", () => {
    const a = [{ at: "2026-10-01T00:00:00Z", object: "contract", action: "a" }];
    const b = [
      { at: "2026-10-03T00:00:00Z", object: "system", action: "b" },
      { at: "2026-09-01T00:00:00Z", object: "system", action: "c" },
    ];
    expect(mergeActivity([a, b], 2).map((x) => x.action)).toEqual(["b", "a"]);
  });

  it("link chat / HĐ / đối tác; chi tiết gọn", () => {
    expect(chatLink({ conversation_id: "c1", flow_id: "f1", room_id: null })).toBe("/c/c1?flow=f1");
    expect(chatLink({ conversation_id: "c1", flow_id: "f1", room_id: "r1" })).toBe("/rooms/r1");
    expect(recordLink("contract", "id1", null)).toBe("/contracts/id1");
    expect(recordLink("partner", null, "tax:0101")).toBe("/partners?party=tax%3A0101");
    expect(recordLink("system", null, null)).toBeNull();
    expect(compactDetail({})).toBeUndefined();
    expect(compactDetail({ a: "x".repeat(400) })?.length).toBe(300);
  });
});
