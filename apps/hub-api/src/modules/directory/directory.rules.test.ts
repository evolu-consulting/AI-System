// HUB-FR-102 · likePattern: không ký tự đại diện nào lọt qua (Y04).
import { describe, expect, test } from "bun:test";
import { likePattern } from "./directory.rules";

describe("likePattern", () => {
  test("bọc %…% và thoát ký tự đại diện", () => {
    expect(likePattern("lan")).toBe("%lan%");
    expect(likePattern("%_\\")).toBe(String.raw`%\%\_\\%`);
  });
  test("chuỗi Unicode giữ nguyên", () => {
    expect(likePattern("Cúc Lê")).toBe("%Cúc Lê%");
  });
});
