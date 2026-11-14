import { describe, expect, it } from "bun:test";
import { decodeCursor, encodeCursor, isContractsLink } from "./connect.codec";

const ID = "7e5d00a1-0000-4000-8000-000000000001";

describe("CR-161 · con trỏ phân trang", () => {
  it("mã hoá rồi giải mã trả đúng, giữ phần micro giây", () => {
    const c = { t: "2026-11-15T03:00:00.123456Z", id: ID };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("sai dạng ⇒ null (rác, JSON thừa khoá, ngày sai, uuid sai)", () => {
    expect(decodeCursor("%%%")).toBeNull();
    expect(decodeCursor(Buffer.from("{}").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":"x","id":"y"}').toString("base64url"))).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ t: "2026-11-15T03:00:00Z", id: ID, extra: 1 })).toString(
          "base64url",
        ),
      ),
    ).toBeNull();
  });
});

describe("CR-161 · link chuông chỉ trong /contracts", () => {
  it("nhận đường dẫn Hợp đồng", () => {
    expect(isContractsLink("/contracts/partners?invites=1")).toBe(true);
    expect(
      isContractsLink("/contracts/partners?party=Preschool%20Vi%E1%BB%87t&tenant=x&tab=chat"),
    ).toBe(true);
    expect(isContractsLink("/contracts/partners")).toBe(true);
  });
  it("từ chối ra ngoài / lược đồ / ký tự lạ", () => {
    for (const l of [
      "https://evil.com",
      "//evil.com",
      "/other",
      "/contracts//x",
      "javascript:alert(1)",
      "/contracts/<x>",
      "/contractsx",
      "",
    ])
      expect(isContractsLink(l)).toBe(false);
  });
});
