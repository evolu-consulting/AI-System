import { describe, expect, test } from "bun:test";
import { checkSettingsPath, pathProblems } from "./check-settings-path";
import { repoRoot } from "./lib/git";

const labels = { "Cài đặt": ["Công ty", "Quy trình duyệt"], "Công ty": ["Quy trình", "Ứng dụng"] };

describe("check-settings-path (CR-125 c3)", () => {
  test("đường dẫn đúng ⇒ không lỗi", () => {
    expect(pathProblems("Vào Cài đặt › Quy trình duyệt rồi bấm", labels)).toEqual([]);
    expect(pathProblems("chọn ở Công ty › Quy trình.", labels)).toEqual([]);
  });
  test("mục không tồn tại (Cài đặt › Ký số) ⇒ lỗi", () => {
    expect(pathProblems("Bật ở Cài đặt › Ký số.", labels)).toHaveLength(1);
  });
  test("dấu > thay vì › ⇒ lỗi", () => {
    expect(pathProblems("Cài đặt > Quy trình duyệt", labels)).toHaveLength(1);
  });
  test("không nhắc đường dẫn ⇒ bỏ qua", () => {
    expect(pathProblems("Công ty chưa bật ký số", labels)).toEqual([]);
  });
  test("nội dung gd0 sạch", () => {
    expect(checkSettingsPath(repoRoot())).toEqual([]);
  });
});
