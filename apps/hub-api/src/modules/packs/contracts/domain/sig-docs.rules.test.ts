// CR-188 · BR-188-5: con trỏ trang và cắt 50 dòng của «Giấy tờ đã ký bằng chữ ký này».
import { describe, expect, it } from "bun:test";
import { SIG_DOCS_PAGE } from "@ai/contracts/pack-contracts";
import { decodeCursor, encodeCursor, pageOf } from "./sig-docs.rules";

const ID = "22222222-2222-4222-8222-222222222222";
const row = (i: number) => ({
  signed_at: new Date(Date.UTC(2026, 9, 1, 0, 0, 0) - i * 1000).toISOString(),
  version_id: ID,
});

describe("CR-188 sig-docs.rules", () => {
  it("con trỏ mã hoá rồi giải lại đúng; sai dạng ⇒ null", () => {
    const c = { at: "2026-10-01T00:00:00.000Z", id: ID };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("rac")).toBeNull();
    expect(decodeCursor(`khong-phai-ngay|${ID}`)).toBeNull();
    expect(decodeCursor("2026-10-01T00:00:00Z|x")).toBeNull();
  });
  it("trang đầy 50 + 1 dòng thừa ⇒ cắt 50 và có con trỏ, ít hơn thì hết", () => {
    const full = Array.from({ length: SIG_DOCS_PAGE + 1 }, (_, i) => row(i));
    const p = pageOf(full);
    expect(p.items.length).toBe(SIG_DOCS_PAGE);
    expect(p.next).toBe(encodeCursor({ at: row(SIG_DOCS_PAGE - 1).signed_at, id: ID }));
    expect(pageOf(full.slice(0, SIG_DOCS_PAGE)).next).toBeNull();
    expect(pageOf([]).next).toBeNull();
  });
});
