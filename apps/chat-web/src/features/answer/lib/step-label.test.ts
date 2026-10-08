// CR-054 · tiền tố agent của bước.
import { describe, expect, test } from "bun:test";
import { modelLabel, stepAgentPrefix } from "./step-label";

describe("modelLabel", () => {
  test("alias viết hoa chữ đầu; default/null không hiện; id giữ nguyên", () => {
    expect(modelLabel("haiku")).toBe("Haiku");
    expect(modelLabel("sonnet")).toBe("Sonnet");
    expect(modelLabel("opus")).toBe("Opus");
    expect(modelLabel("default")).toBeNull();
    expect(modelLabel(null)).toBeNull();
    expect(modelLabel("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  });
});

describe("stepAgentPrefix", () => {
  test("tên · model; không model → chỉ tên; không agent → null", () => {
    expect(stepAgentPrefix({ name: "Orchestrator", model: "haiku" })).toBe("Orchestrator · Haiku");
    expect(stepAgentPrefix({ name: "Invoices", model: null })).toBe("Invoices");
    expect(stepAgentPrefix(undefined)).toBeNull();
  });
});
