// ADM-FR-37 · plan-frontend §0 D6 · ghép URL Hub từ `PUBLIC_HUB_URL`.
import { describe, expect, test } from "bun:test";
import { hubConfigured, hubUrl, normalizeHubBase } from "./hub";

describe("hubUrl", () => {
  test("bỏ / cuối và khoảng trắng", () => {
    expect(normalizeHubBase(" http://hub:4000/ ")).toBe("http://hub:4000");
    expect(normalizeHubBase("http://hub:4000//")).toBe("http://hub:4000");
  });
  test("vắng hoặc rỗng → chưa cấu hình, hubUrl null", () => {
    expect(normalizeHubBase(undefined)).toBe("");
    expect(hubConfigured("")).toBe(false);
    expect(hubUrl("/agent-grants", "")).toBeNull();
  });
  test("ghép base + path", () => {
    expect(hubConfigured("http://hub:4000")).toBe(true);
    expect(hubUrl("/agent-grants", "http://hub:4000")).toBe("http://hub:4000/agent-grants");
  });
});
