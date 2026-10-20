// M2-chat · m2c (review A-19) · Studio kiểm `runtime_options.pack_tools` theo registry tool gói khi lưu agent.
import { describe, expect, it } from "bun:test";
import { checkPackTools } from "./agents.service";

const reg = { has: (k: string) => k === "contracts-search" };

describe("m2c · checkPackTools", () => {
  it("tool có trong registry / không khai / vắng registry ⇒ qua", () => {
    expect(() => checkPackTools({ pack_tools: ["contracts-search"] }, reg)).not.toThrow();
    expect(() => checkPackTools({}, reg)).not.toThrow();
    expect(() => checkPackTools({ pack_tools: ["la-lam"] }, undefined)).not.toThrow();
  });

  it("tool lạ ⇒ INVALID_REFERENCE nêu khoá lạ", () => {
    try {
      checkPackTools({ pack_tools: ["contracts-search", "la-lam"] }, reg);
      throw new Error("không ném");
    } catch (e) {
      expect(JSON.stringify(e)).toContain("INVALID_REFERENCE");
      expect(JSON.stringify(e)).toContain("la-lam");
    }
  });
});
