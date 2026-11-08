import { describe, expect, it } from "bun:test";
import { filterInbox, type InboxRow, joinParts, sortInbox } from "./inbox";

const row = (p: Partial<InboxRow> & Pick<InboxRow, "kind" | "key">): InboxRow => ({
  tag: "",
  summary: "",
  due: null,
  escalated: false,
  since: null,
  to: { to: "/contracts/c/$id", params: { id: "x" } },
  ...p,
});

describe("inbox rows", () => {
  it("câu tóm tắt bỏ phần thiếu", () => {
    expect(joinParts(["Mua hàng", null, "1.500.000 đ", "", "An"])).toBe(
      "Mua hàng · 1.500.000 đ · An",
    );
  });
  it("sắp: có hạn gần trước, rồi chờ lâu nhất", () => {
    const rows = [
      row({ kind: "request", key: "new", since: "2026-11-09T00:00:00Z" }),
      row({ kind: "sign", key: "old", since: "2026-11-01T00:00:00Z" }),
      row({ kind: "approval", key: "late", due: { at: "2026-11-05T00:00:00Z", late: true } }),
      row({ kind: "approval", key: "soon", due: { at: "2026-11-20T00:00:00Z", late: false } }),
    ];
    expect(sortInbox(rows).map((r) => r.key)).toEqual(["late", "soon", "old", "new"]);
  });
  it("chip: Cần ký chỉ việc ký, Cần duyệt là phần còn lại", () => {
    const rows = [
      row({ kind: "sign", key: "s" }),
      row({ kind: "approval", key: "a" }),
      row({ kind: "request", key: "r" }),
    ];
    expect(filterInbox(rows, "sign").map((r) => r.key)).toEqual(["s"]);
    expect(filterInbox(rows, "approve").map((r) => r.key)).toEqual(["a", "r"]);
    expect(filterInbox(rows, "all")).toHaveLength(3);
  });
});
