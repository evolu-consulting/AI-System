// CR-184 · con trỏ tải dần của lịch sử uỷ quyền.
import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor } from "./delegations.cursor";

const C = { at: "2026-11-18T10:20:30.123456Z", id: "00000000-0000-4000-8000-000000000001" };

describe("delegations.cursor", () => {
  test("mã hoá rồi giải mã giữ nguyên micro-giây và id", () => {
    expect(decodeCursor(encodeCursor(C))).toEqual(C);
  });
  test("vắng ⇒ null (trang đầu); sai định dạng ⇒ lỗi", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(() => decodeCursor("bad")).toThrow();
    expect(() => decodeCursor(Buffer.from('["x","y"]').toString("base64url"))).toThrow();
  });
});
