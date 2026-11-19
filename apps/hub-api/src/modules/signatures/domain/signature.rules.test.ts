// CR-181 · lát s2 · unit luật thuần chữ ký nội bộ: needs_create (4 trường hợp + chữ ký tắt riêng), quyền đổi, kiểm PNG, quản trị công ty.
import { describe, expect, it } from "bun:test";
import { SIGNATURE_PNG_MAX_BYTES, SIGNATURE_SETTINGS_DEFAULT } from "@ai/contracts/signature";
import {
  canChangeNow,
  changeNeedsGrant,
  changeRequestApplies,
  changeStateOf,
  checkPng,
  isCompanyAdmin,
  kindAllowed,
  needsCreate,
  profileCaption,
} from "./signature.rules";

const on = { ...SIGNATURE_SETTINGS_DEFAULT, on_doc_enabled: true };
const none = { main: null, initials: null };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("needsCreate", () => {
  it("tắt ký trên tài liệu ⇒ không bắt tạo", () => {
    expect(needsCreate(SIGNATURE_SETTINGS_DEFAULT, none)).toBe(false);
  });
  it("bật + chưa có chữ ký chính ⇒ phải tạo (kể cả required=false: chỉ đổi nút «Làm sau»)", () => {
    expect(needsCreate(on, none)).toBe(true);
    expect(needsCreate({ ...on, required: false }, none)).toBe(true);
  });
  it("bật + đã có chữ ký chính theo cách còn cho phép ⇒ không", () => {
    expect(needsCreate(on, { main: { method: "draw" }, initials: null })).toBe(false);
  });
  it("bật + cách tạo của bản đang dùng đã bị bỏ khỏi methods ⇒ phải tạo lại", () => {
    expect(
      needsCreate({ ...on, methods: ["type"] }, { main: { method: "draw" }, initials: null }),
    ).toBe(true);
  });
  it("chữ ký tắt riêng (own): thiếu/lỗi thời ⇒ phải tạo; shrink ⇒ không cần", () => {
    const own = { ...on, initials: "own" as const };
    expect(needsCreate(own, { main: { method: "draw" }, initials: null })).toBe(true);
    expect(needsCreate(own, { main: { method: "draw" }, initials: { method: "type" } })).toBe(
      false,
    );
    expect(needsCreate(on, { main: { method: "draw" }, initials: null })).toBe(false);
  });
});

describe("đổi chữ ký (Q10)", () => {
  const admin = { ...on, change_policy: "admin" as const };
  it("changeNeedsGrant: chỉ khi policy admin ∧ đã có bản dùng được; lần đầu / bản lỗi thời thì không", () => {
    expect(changeNeedsGrant(admin, null)).toBe(false);
    expect(changeNeedsGrant(admin, { method: "draw" })).toBe(true);
    expect(changeNeedsGrant({ ...admin, methods: ["type"] }, { method: "draw" })).toBe(false);
    expect(changeNeedsGrant(on, { method: "draw" })).toBe(false);
  });
  it("canChangeNow: self ∨ granted ∨ đang buộc tạo lại", () => {
    expect(canChangeNow(on, "none", false)).toBe(true);
    expect(canChangeNow(admin, "none", false)).toBe(false);
    expect(canChangeNow(admin, "requested", false)).toBe(false);
    expect(canChangeNow(admin, "granted", false)).toBe(true);
    expect(canChangeNow(admin, "none", true)).toBe(true);
  });
  it("changeStateOf theo hàng mở", () => {
    expect(changeStateOf(null)).toBe("none");
    expect(changeStateOf({ grantedAt: null })).toBe("requested");
    expect(changeStateOf({ grantedAt: "2026-01-01T00:00:00.000Z" })).toBe("granted");
  });
  it("changeRequestApplies: policy self ⇒ không; admin ∧ chưa có chữ ký ⇒ không", () => {
    expect(changeRequestApplies(on, { main: { method: "draw" }, initials: null })).toBe(false);
    expect(changeRequestApplies(admin, none)).toBe(false);
    expect(changeRequestApplies(admin, { main: { method: "draw" }, initials: null })).toBe(true);
  });
  it("kindAllowed: initials chỉ khi own", () => {
    expect(kindAllowed(on, "main")).toBe(true);
    expect(kindAllowed(on, "initials")).toBe(false);
    expect(kindAllowed({ ...on, initials: "own" }, "initials")).toBe(true);
  });
});

describe("checkPng", () => {
  const png = (n: number, w = 100, h = 50) => {
    const b = new Uint8Array(n).fill(1);
    b.set(PNG);
    const v = new DataView(b.buffer);
    v.setUint32(8, 13);
    b.set([0x49, 0x48, 0x44, 0x52], 12);
    v.setUint32(16, w);
    v.setUint32(20, h);
    return b;
  };
  it("PNG thật trong hạn ⇒ ok", () => expect(checkPng(png(100))).toBe("ok"));
  it("đúng 200 KiB ⇒ ok; hơn 1 byte ⇒ too_large (thắng not_png)", () => {
    expect(checkPng(png(SIGNATURE_PNG_MAX_BYTES))).toBe("ok");
    expect(checkPng(new Uint8Array(SIGNATURE_PNG_MAX_BYTES + 1))).toBe("too_large");
  });
  it("kích thước khai trong IHDR: ≤ 2000×1000 ⇒ ok, vượt rộng hoặc cao ⇒ dimensions_too_large (PNG 200 KiB khai 20000×20000)", () => {
    expect(checkPng(png(200, 2000, 1000))).toBe("ok");
    expect(checkPng(png(200, 2001, 10))).toBe("dimensions_too_large");
    expect(checkPng(png(200, 10, 1001))).toBe("dimensions_too_large");
    expect(checkPng(png(SIGNATURE_PNG_MAX_BYTES, 20000, 20000))).toBe("dimensions_too_large");
  });
  it("IHDR thiếu/sai (không có khối IHDR, 0 điểm ảnh) ⇒ not_png", () => {
    const noHdr = png(200);
    noHdr.set([0x49, 0x44, 0x41, 0x54], 12);
    expect(checkPng(noHdr)).toBe("not_png");
    expect(checkPng(png(200, 0, 10))).toBe("not_png");
    expect(checkPng(Uint8Array.from([...PNG, 0, 0, 0, 13]))).toBe("not_png");
  });
  it("không phải PNG / quá ngắn ⇒ not_png", () => {
    expect(checkPng(new Uint8Array(100))).toBe("not_png");
    expect(checkPng(Uint8Array.from(PNG.slice(0, 4)))).toBe("not_png");
    expect(checkPng(new Uint8Array(0))).toBe("not_png");
  });
});

describe("isCompanyAdmin (Q15)", () => {
  it("tenant_admin ∨ quản trị gói; member thường và platform_admin không có quyền gói thì không", () => {
    expect(isCompanyAdmin("tenant_admin", false)).toBe(true);
    expect(isCompanyAdmin("member", true)).toBe(true);
    expect(isCompanyAdmin("member", false)).toBe(false);
    expect(isCompanyAdmin("platform_admin", false)).toBe(false);
  });
});

describe("profileCaption (BR-188-1)", () => {
  it("Họ tên · Chức vụ · Phòng ban, bỏ phần trống; hồ sơ trống ⇒ null", () => {
    expect(profileCaption({ name: "Bình", title: "Giám đốc", department: "Kinh doanh" })).toBe(
      "Bình · Giám đốc · Kinh doanh",
    );
    expect(profileCaption({ name: " Bình ", title: null, department: "Kinh doanh" })).toBe(
      "Bình · Kinh doanh",
    );
    expect(profileCaption({ name: "", title: "  ", department: null })).toBeNull();
  });
});
