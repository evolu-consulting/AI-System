// CR-110 · COM-FR-41/42 · khoá `?sec=` → mục Cài đặt.
import { describe, expect, test } from "bun:test";
import { allowedSections, navFromKey, pickNav, sectionFromKey } from "./section-key";

describe("sectionFromKey", () => {
  test("khoá hợp lệ ⇒ đúng mục", () => {
    for (const k of ["co", "rep", "biz", "scout", "flow", "sign"])
      expect(sectionFromKey(k)).toBe(k as never);
  });
  test("CR-125 · khoá cũ apps ⇒ mục Quy trình duyệt (đã gộp một cửa)", () => {
    expect(sectionFromKey("apps")).toBe("flow");
  });
  test("khoá lạ ⇒ mục mặc định co", () => {
    expect(sectionFromKey("esign")).toBe("co");
    expect(sectionFromKey("CO")).toBe("co");
  });
  test("không có / rỗng / không phải chuỗi ⇒ null (giữ hành vi cũ)", () => {
    expect(sectionFromKey(undefined)).toBeNull();
    expect(sectionFromKey("")).toBeNull();
    expect(sectionFromKey(["flow"])).toBeNull();
  });
});

describe("CR-130 · pickNav (một trang Cài đặt, nhóm theo gói)", () => {
  test("mục được chọn còn nhóm ⇒ giữ; mất nhóm ⇒ mục đầu của nhóm còn lại", () => {
    expect(pickNav("rep", true, true)).toBe("rep");
    expect(pickNav("feed", true, true)).toBe("feed");
    expect(pickNav("feed", true, false)).toBe("co");
    expect(pickNav("co", false, true)).toBe("feed"); // người chỉ có Cộng đồng
    expect(pickNav("flow", false, true)).toBe("feed");
  });
});

describe("CR-138 Q6 · mục theo quyền", () => {
  test("chủ sở hữu thấy đủ 6 mục (CR-138b: thêm «sign» = Ký & đối tác); người khác chỉ «flow»", () => {
    expect(allowedSections(true)).toEqual(["co", "rep", "biz", "scout", "flow", "sign"]);
    expect(allowedSections(false)).toEqual(["flow"]);
  });
  test("link cũ tới mục bị ẩn ⇒ mục đầu tiên được phép, không lỗi", () => {
    for (const k of ["co", "rep", "biz", "scout"] as const)
      expect(pickNav(k, true, true, false)).toBe("flow");
    expect(pickNav("flow", true, true, false)).toBe("flow");
    expect(pickNav("rep", true, true, true)).toBe("rep");
  });
  test("không có Bảng tin + không phải chủ ⇒ flow; chỉ Cộng đồng ⇒ feed", () => {
    expect(pickNav("feed", true, false, false)).toBe("flow");
    expect(pickNav("co", false, true, false)).toBe("feed");
  });
});

describe("CR-130 · navFromKey (link cũ ?sec=feed ⇒ ngăn Bảng tin)", () => {
  test("feed ⇒ feed; khoá khác như sectionFromKey; rỗng ⇒ null", () => {
    expect(navFromKey("feed")).toBe("feed");
    expect(navFromKey("flow")).toBe("flow");
    expect(navFromKey("lạ")).toBe("co");
    expect(navFromKey(undefined)).toBeNull();
  });
});
