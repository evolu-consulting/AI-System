import { describe, expect, test } from "bun:test";
import { expandPathTokens, settingsPath, settingsSectionKeys } from "./settings-paths";

describe("CR-125 c3 · settings-paths", () => {
  test("đường dẫn lấy từ nhãn mục thật", () => {
    expect(settingsPath("vi", "flow")).toBe("Cài đặt › Quy trình duyệt");
    expect(settingsPath("en", "flow")).toBe("Settings › Approval flow");
  });
  test("CR-138b · tab Ký & đối tác", () => {
    expect(settingsPath("vi", "sign")).toBe("Cài đặt › Ký & đối tác");
    expect(settingsPath("en", "sign")).toBe("Settings › Signing & partners");
  });
  test("mục lạ hoặc khoá Hint ⇒ throw", () => {
    expect(() => settingsPath("vi", "esign")).toThrow();
    expect(() => settingsPath("vi", "flowHint")).toThrow();
  });
  test("mở rộng token trong cây lồng, giữ nguyên chuỗi khác", () => {
    const out = expandPathTokens(
      { a: { b: "Vào {{path:flow}} rồi bấm" }, n: 1, l: ["{{path:co}}"] },
      "vi",
    );
    expect(out).toEqual({
      a: { b: "Vào Cài đặt › Quy trình duyệt rồi bấm" },
      n: 1,
      l: ["Cài đặt › Công ty"],
    });
  });
  test("danh sách mục", () => {
    expect(settingsSectionKeys()).toEqual(["feed", "co", "rep", "biz", "scout", "flow", "sign"]);
  });
});
