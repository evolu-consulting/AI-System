// CR-124 q2 · luật dấu «Đã xác minh» (FLOW4-FR-03/05). CR-187: công tắc «cho tìm thấy» đã chuyển sang workspace-web (discoverable.test.ts).
import { describe, expect, test } from "bun:test";
import { directoryView } from "./directory";

const base = {
  tax_code: "0312345678",
  directory_verified: null,
};

describe("CR-124 q2 · directoryView", () => {
  test("quản trị công ty không thấy công tắc xác minh", () => {
    expect(directoryView(base, false).verified.visible).toBe(false);
  });

  test("quản trị nền tảng: xác minh cần MST, hiện ngày + người xác minh", () => {
    const v = directoryView(base, true);
    expect(v.verified).toMatchObject({ visible: true, checked: false, enabled: true });
    expect(directoryView({ ...base, tax_code: null }, true).verified.enabled).toBe(false);
    const done = directoryView(
      { ...base, directory_verified: { at: "2026-11-07T01:00:00.000Z", by_name: "Admin" } },
      true,
    );
    expect(done.verified).toMatchObject({
      checked: true,
      at: "2026-11-07T01:00:00.000Z",
      by: "Admin",
    });
  });
});
