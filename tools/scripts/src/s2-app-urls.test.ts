import { describe, expect, it } from "bun:test";
import { planUrlChanges, targetUrls } from "./s2-app-urls";

describe("s2-app-urls", () => {
  it("chỉ đổi hàng còn localhost, giữ hàng đã đổi/sửa tay, bỏ khoá lạ", () => {
    const plan = planUrlChanges("evoluconsulting.com", [
      { key: "chat", url: "http://localhost:18433" },
      { key: "contracts", url: "http://127.0.0.1:18431/" },
      { key: "studio", url: "http://localhost:18434/studio/" },
      { key: "admin", url: "https://admin.custom.example" },
      { key: "community", url: "http://localhost:18435" },
      { key: "other", url: "http://localhost:1" },
    ]);
    expect(plan.map((c) => [c.key, c.to])).toEqual([
      ["chat", "https://ai-test.evoluconsulting.com"],
      ["contracts", "https://sohoptac-test.evoluconsulting.com"],
      ["studio", "https://ai-test-hub.evoluconsulting.com/studio/"],
      ["community", "https://community-test.evoluconsulting.com"],
    ]);
    // Chạy lại sau khi đã áp dụng ⇒ không còn gì để đổi (idempotent).
    const after = plan.map((c) => ({ key: c.key, url: c.to }));
    expect(planUrlChanges("evoluconsulting.com", after)).toEqual([]);
  });
  it("--hosts prod: đổi hàng localhost và -test sang host prod, giữ hàng khác", () => {
    const plan = planUrlChanges(
      "evoluconsulting.com",
      [
        { key: "chat", url: "https://ai-test.evoluconsulting.com" },
        { key: "contracts", url: "http://localhost:18431" },
        { key: "studio", url: "https://ai-test-hub.evoluconsulting.com/studio/" },
        { key: "admin", url: "https://admin.custom.example" },
        { key: "community", url: "https://community-test.evoluconsulting.com" },
      ],
      "prod",
    );
    expect(plan.map((c) => [c.key, c.to])).toEqual([
      ["chat", "https://ai.evoluconsulting.com"],
      ["contracts", "https://sohoptac.evoluconsulting.com"],
      ["studio", "https://ai-hub.evoluconsulting.com/studio/"],
      ["community", "https://community.evoluconsulting.com"],
    ]);
    const after = plan.map((c) => ({ key: c.key, url: c.to }));
    expect(planUrlChanges("evoluconsulting.com", after, "prod")).toEqual([]);
  });
  it("từ chối base-domain sai", () => {
    expect(() => targetUrls("x/../y")).toThrow();
  });
});
