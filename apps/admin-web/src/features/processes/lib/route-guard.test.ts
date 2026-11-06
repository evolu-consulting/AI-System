import { describe, expect, test } from "bun:test";
import { isProcessesList, listRedirectTarget, notFoundBack } from "./route-guard";

describe("CR-121 f3 · chỉ danh sách /processes bị chuyển hướng", () => {
  test("danh sách (kể cả dấu / cuối) là danh sách; trang con thì không", () => {
    expect(isProcessesList("/processes")).toBe(true);
    expect(isProcessesList("/processes/")).toBe(true);
    expect(isProcessesList("/processes/abc")).toBe(false);
    expect(isProcessesList("/processes/abc/runs/r1")).toBe(false);
    expect(isProcessesList("/processes/new")).toBe(false);
  });
  test("listRedirectTarget giữ đích ở danh sách, bỏ ở trang con (tenant_admin vào được lượt chạy)", () => {
    expect(listRedirectTarget("/processes", "t1")).toBe("t1");
    expect(listRedirectTarget("/processes/abc/runs/r1", "t1")).toBeNull();
    expect(listRedirectTarget("/processes/abc", "t1")).toBeNull();
    expect(listRedirectTarget("/processes", null)).toBeNull();
  });
  test("nút quay lại của 'Không tìm thấy': tenant_admin về công ty mình, platform về Thư viện", () => {
    expect(notFoundBack("tenant_admin")).toBe("/tenants");
    expect(notFoundBack("platform_admin")).toBe("/processes");
    expect(notFoundBack(undefined)).toBe("/processes");
  });
});
