// CR-130 · khối Bảng tin của đối tác SHT: nhóm hàng, câu lỗi, link Admin.
import { describe, expect, test } from "bun:test";
import { adminPartnersNext, communityErrorKey, parseCats } from "./community-block";

describe("parseCats", () => {
  test("tách dấu phẩy/xuống dòng, bỏ rỗng + trùng, giới hạn 50 và 80 ký tự", () => {
    expect(parseCats(" Chữ ký số, Đóng gói ,,Chữ ký số\nHoá đơn ")).toEqual([
      "Chữ ký số",
      "Đóng gói",
      "Hoá đơn",
    ]);
    expect(parseCats("")).toEqual([]);
    expect(parseCats("a".repeat(120))[0]?.length).toBe(80);
    expect(parseCats(Array.from({ length: 70 }, (_, i) => `c${i}`).join(",")).length).toBe(50);
  });
});

describe("communityErrorKey / adminPartnersNext", () => {
  test("tài khoản đã gắn đối tác khác có câu riêng; mã lạ ⇒ câu chung", () => {
    expect(communityErrorKey("PARTNER_ACCOUNT_TAKEN")).toBe("contracts.pcm.errTaken");
    expect(communityErrorKey("X")).toBe("contracts.pcm.errGeneric");
  });
  test("link Admin mã hoá tên", () => {
    expect(adminPartnersNext("Cty A&B")).toBe("/partners?name=Cty%20A%26B");
  });
});
