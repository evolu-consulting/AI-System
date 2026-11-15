import { describe, expect, test } from "bun:test";
import { ZodError } from "zod";
import {
  parseCompanyFilter,
  partnerPair,
  partnerReadOnly,
  partnerSendError,
  sourcesOf,
} from "./partner.rules";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";

describe("partnerPair", () => {
  test("không phụ thuộc thứ tự đối số", () => {
    const x = { tenantId: A, userId: U1 };
    const y = { tenantId: B, userId: U2 };
    expect(partnerPair(x, y)).toEqual(partnerPair(y, x));
    expect(partnerPair(y, x).a).toEqual(x);
  });
  test("không phân biệt hoa/thường", () => {
    const x = { tenantId: A.toUpperCase(), userId: U1 };
    const y = { tenantId: B, userId: U2 };
    expect(partnerPair(x, y).a.userId).toBe(U1);
  });
  test("cùng công ty ⇒ ném", () => {
    expect(() => partnerPair({ tenantId: A, userId: U1 }, { tenantId: A, userId: U2 })).toThrow();
  });
});

describe("partnerReadOnly (P7)", () => {
  test("bảng chân trị", () => {
    expect(partnerReadOnly(true, true)).toBe(false);
    expect(partnerReadOnly(false, true)).toBe(true);
    expect(partnerReadOnly(true, false)).toBe(true);
    expect(partnerReadOnly(false, false)).toBe(true);
  });
});

describe("partnerSendError (P4)", () => {
  test("kết nối kiểm trước người kia", () => {
    expect(partnerSendError(true, true)).toBeNull();
    expect(partnerSendError(false, true)).toBe("MSG_NOT_CONNECTED");
    expect(partnerSendError(false, false)).toBe("MSG_NOT_CONNECTED");
    expect(partnerSendError(true, false)).toBe("MSG_PEER_INACTIVE");
  });
  test("nhất quán với partnerReadOnly", () => {
    for (const c of [true, false])
      for (const e of [true, false])
        expect(partnerSendError(c, e) !== null).toBe(partnerReadOnly(c, e));
  });
});

describe("parseCompanyFilter · sourcesOf (P9)", () => {
  test("vắng / rỗng / all ⇒ all", () => {
    expect(parseCompanyFilter(undefined, A)).toEqual({ kind: "all" });
    expect(parseCompanyFilter("", A)).toEqual({ kind: "all" });
    expect(parseCompanyFilter("all", A)).toEqual({ kind: "all" });
  });
  test("own hoặc chính công ty mình ⇒ own", () => {
    expect(parseCompanyFilter("own", A)).toEqual({ kind: "own" });
    expect(parseCompanyFilter(A, A)).toEqual({ kind: "own" });
    expect(parseCompanyFilter(A.toUpperCase(), A)).toEqual({ kind: "own" });
  });
  test("uuid công ty khác ⇒ company", () => {
    expect(parseCompanyFilter(B, A)).toEqual({ kind: "company", tenantId: B });
  });
  test("dạng lạ ⇒ ZodError", () => {
    expect(() => parseCompanyFilter("abc", A)).toThrow(ZodError);
  });
  test("nguồn", () => {
    expect(sourcesOf({ kind: "all" })).toEqual({ internal: true, partner: true });
    expect(sourcesOf({ kind: "own" })).toEqual({ internal: true, partner: false });
    expect(sourcesOf({ kind: "company", tenantId: B })).toEqual({ internal: false, partner: true });
  });
});
