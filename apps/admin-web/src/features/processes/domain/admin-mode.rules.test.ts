// CR-103 · fnr-fix-unfreeze · unit: cảnh báo giai đoạn ở chế độ route chỉ quản trị.
import { describe, expect, test } from "bun:test";
import { adminModeWarnings } from "./admin-mode.rules";

describe("adminModeWarnings", () => {
  test("Hub không ở chế độ admin ⇒ không cảnh báo", () => {
    expect(adminModeWarnings(false, { after: "review", gate: true, asks: true })).toEqual([]);
  });
  test("chế độ admin: duyệt bởi Group + có người trả lời ⇒ cả hai", () => {
    expect(adminModeWarnings(true, { after: "review", gate: true, asks: true })).toEqual([
      "review",
      "ask",
    ]);
  });
  test("chế độ admin: tự chạy tiếp / giai đoạn Áp không cảnh báo duyệt; tool/set không cảnh báo trả lời", () => {
    expect(adminModeWarnings(true, { after: "auto", gate: true, asks: true })).toEqual(["ask"]);
    expect(adminModeWarnings(true, { after: "review", gate: false, asks: true })).toEqual(["ask"]);
    expect(adminModeWarnings(true, { after: "review", gate: true, asks: false })).toEqual([
      "review",
    ]);
  });
});
