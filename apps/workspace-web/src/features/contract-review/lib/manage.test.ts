// gap-a1 · luật thuần khối "Quản lý": ô hoa hồng %, dòng lịch sử, câu lỗi.
import { describe, expect, it } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { historyLine, isVisibleEvent, manageErrorKey, parsePct } from "./manage";

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
  it("CR-141 · esign_uploaded ⇒ tên tệp + duyệt thay; sign_upload_open bị ẩn", () => {
    const u = historyLine({
      type: "esign_uploaded",
      actor_user_id: null,
      at,
      data: { file_name: "hd-ky.pdf", override: true },
    });
    expect([u.kind, u.fileName, u.override]).toEqual(["esign_uploaded", "hd-ky.pdf", true]);
    const n = historyLine({ type: "esign_uploaded", actor_user_id: null, at, data: {} });
    expect([n.fileName, n.override]).toEqual([null, false]);
    expect(isVisibleEvent({ type: "sign_upload_open" })).toBe(false);
    expect(isVisibleEvent({ type: "esign_uploaded" })).toBe(true);
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
