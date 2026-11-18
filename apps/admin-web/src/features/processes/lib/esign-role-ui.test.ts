// CR-182 · công ty TẮT ký trên tài liệu ⇒ bước Ký giữ cách cũ: không tự gán vai, ẩn «Chuyển sang vai», cảnh báo bước chỉ có vai.
import { describe, expect, test } from "bun:test";
import { esignRoleUi } from "./esign-role-ui";

describe("esignRoleUi", () => {
  test("công ty BẬT: bước mới tự nhận vai mặc định; cấu hình cũ thấy nút chuyển; không cảnh báo", () => {
    expect(esignRoleUi({}, true)).toEqual({ autoRole: true, canSwitch: false, blocked: false });
    expect(esignRoleUi({ provider: "upload" }, true)).toEqual({
      autoRole: false,
      canSwitch: true,
      blocked: false,
    });
    expect(esignRoleUi({ signer_role: "a", provider: "upload" }, true).canSwitch).toBe(false);
  });
  test("công ty TẮT: không tự gán vai, không nút chuyển, bước chỉ có vai thì cảnh báo", () => {
    expect(esignRoleUi({}, false)).toEqual({ autoRole: false, canSwitch: false, blocked: false });
    expect(esignRoleUi({ provider: "upload" }, false).canSwitch).toBe(false);
    expect(esignRoleUi({ signer_role: "a" }, false).blocked).toBe(true);
    expect(esignRoleUi({ signer_role: "a", provider: "upload" }, false).blocked).toBe(false);
  });
  test("chưa biết công ty bật hay tắt (options chưa tải / API cũ) ⇒ giữ cách cũ, không cảnh báo", () => {
    expect(esignRoleUi({}, undefined)).toEqual({
      autoRole: false,
      canSwitch: false,
      blocked: false,
    });
    expect(esignRoleUi({ signer_role: "a" }, undefined).blocked).toBe(false);
  });
});
