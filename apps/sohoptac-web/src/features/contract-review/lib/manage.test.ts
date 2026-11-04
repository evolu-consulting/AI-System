// gap-a1 · luật thuần khối "Quản lý": ô hoa hồng %, dòng lịch sử, câu lỗi.
import { describe, expect, it } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { historyLine, manageErrorKey, parsePct } from "./manage";

describe("parsePct", () => {
  it("trống ⇒ null; số hợp lệ ⇒ số; ngoài 0–100 hoặc quá 2 số lẻ ⇒ sai", () => {
    expect(parsePct("  ")).toEqual({ ok: true, value: null });
    expect(parsePct("8,5")).toEqual({ ok: true, value: 8.5 });
    expect(parsePct("100")).toEqual({ ok: true, value: 100 });
    for (const bad of ["101", "-1", "1.234", "abc", "5%"])
      expect(parsePct(bad)).toEqual({ ok: false });
  });
});

describe("historyLine", () => {
  const at = "2026-10-21T01:00:00Z";
  it("field_edited ⇒ danh sách khác biệt; owner/commission ⇒ cặp từ → đến; loại lạ ⇒ other", () => {
    const f = historyLine({
      type: "field_edited",
      actor_user_id: null,
      at,
      data: { changes: [{ key: "title", old: "A", new: "B" }] },
    });
    expect([f.kind, f.diffs]).toEqual(["field_edited", [{ key: "title", old: "A", new: "B" }]]);
    const c = historyLine({
      type: "commission_edited",
      actor_user_id: null,
      at,
      data: { from: 5, to: 7.5 },
    });
    expect([c.kind, c.from, c.to]).toEqual(["commission_edited", "5", "7.5"]);
    expect(historyLine({ type: "zzz_new", actor_user_id: null, at, data: {} }).kind).toBe("other");
  });
});

describe("manageErrorKey", () => {
  it("mã máy chủ ⇒ khoá riêng; 429 ⇒ cap; lạ ⇒ unknown", () => {
    const e = (status: number, code: string) => new ApiError(status, code as ApiError["code"], "x");
    expect(manageErrorKey(e(409, "EXTRACT_BUSY"))).toBe("contracts.gapa1.err.busy");
    expect(manageErrorKey(e(429, "WHATEVER"))).toBe("contracts.gapa1.err.cap");
    expect(manageErrorKey(e(422, "OWNER_INVALID"))).toBe("contracts.gapa1.err.ownerInvalid");
    expect(manageErrorKey(new Error("x"))).toBe("contracts.errors.unknown");
  });
});
