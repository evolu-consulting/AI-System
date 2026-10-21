import { describe, expect, it } from "bun:test";
import { planUrlChanges, targetUrls } from "./s2-app-urls";

describe("s2-app-urls", () => {
  it("chỉ đổi hàng còn localhost, giữ hàng đã đổi/sửa tay, bỏ khoá lạ", () => {
    const plan = planUrlChanges("evoluconsulting.com", [
      { key: "chat", url: "http://localhost:18433" },
      { key: "contracts", url: "http://127.0.0.1:18431/" },
      { key: "studio", url: "http://localhost:18434/studio/" },
      { key: "admin", url: "https://admin.custom.example" },
      { key: "other", url: "http://localhost:1" },
    ]);
    expect(plan.map((c) => [c.key, c.to])).toEqual([
      ["chat", "https://ai2.evoluconsulting.com"],
      ["contracts", "https://sohoptac2.evoluconsulting.com"],
      ["studio", "https://ai2-hub.evoluconsulting.com/studio/"],
    ]);
    // Chạy lại sau khi đã áp dụng ⇒ không còn gì để đổi (idempotent).
    const after = plan.map((c) => ({ key: c.key, url: c.to }));
    expect(planUrlChanges("evoluconsulting.com", after)).toEqual([]);
  });
  it("từ chối base-domain sai", () => {
    expect(() => targetUrls("x/../y")).toThrow();
  });
});
