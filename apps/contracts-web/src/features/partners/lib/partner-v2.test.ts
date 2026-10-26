// V2-I · U3 · luật thuần Đối tác UI: URL, lọc HĐ theo giai đoạn, ghi chú từ tìm internet.
import { describe, expect, test } from "bun:test";
import type { PartnerContractRow } from "@ai/contracts";
import { byStage, noteOfLine, parsePartnersSearch, stageCounts } from "./partner-v2";

describe("V2-I URL", () => {
  test("chỉ giữ tham số hợp lệ; không có party ⇒ danh sách; vai chỉ khách hàng / nhà cung cấp", () => {
    expect(parsePartnersSearch({ tab: "review" })).toEqual({});
    expect(parsePartnersSearch({ party: "tax:1", role: "customer", tab: "contracts" })).toEqual({
      party: "tax:1",
      role: "customer",
      tab: "contracts",
    });
    expect(
      parsePartnersSearch({ party: "tax:1", role: "commission_payer", tab: "overview" }),
    ).toEqual({
      party: "tax:1",
    });
  });
});

describe("V2-I HĐ theo giai đoạn", () => {
  const r = (id: string, stage: PartnerContractRow["stage"]) =>
    ({ id, stage }) as PartnerContractRow;
  test("đếm + lọc Chưa bắt đầu / Đang / Đã xong", () => {
    const rows = [
      r("1", "done"),
      r("2", "in_progress"),
      r("3", "in_progress"),
      r("4", "not_started"),
    ];
    expect(stageCounts(rows)).toEqual({ all: 4, not_started: 1, in_progress: 2, done: 1 });
    expect(byStage(rows, "in_progress").map((x) => x.id)).toEqual(["2", "3"]);
    expect(byStage(rows, "all")).toHaveLength(4);
  });
  test("dòng tìm internet ⇒ nội dung ghi chú", () => {
    expect(noteOfLine({ title: "T", summary: "S", source: "x.vn" })).toBe("T: S (x.vn)");
    expect(noteOfLine({ title: "T", summary: "", source: null })).toBe("T");
  });
});
