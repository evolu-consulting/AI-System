// Demo · demo-ai-fix + seed-demo-v2: chỉ tenant demo, tên công ty giả, đối tác mẫu đều có điện thoại + liên hệ.
import { describe, expect, it } from "bun:test";
import { assertDemo, DOC_CHUNKS, docHash, TIERED_AGENTS } from "./demo-ai-fix";
import { POLICY_CHUNKS, POLICY_TITLE, policyHash } from "./demo-ai-fix.policy";
import { companyRows } from "./seed-demo-v2.build-people";
import { OWN, PARTNERS } from "./seed-demo-v2.specs";

describe("demo-ai-fix", () => {
  it("từ chối tenant khác demo (nitigroup, rỗng)", () => {
    expect(() => assertDemo("nitigroup")).toThrow();
    expect(() => assertDemo(undefined)).toThrow();
    expect(() => assertDemo("demo")).not.toThrow();
  });
  it("tài liệu tri thức giả: băm ổn định, có dữ kiện hỏi được", () => {
    expect(docHash()).toBe(docHash());
    expect(DOC_CHUNKS.map((c) => c.body).join(" ")).toContain("500 triệu");
  });
  it("ai-tiers-rag · tài liệu QC-TC-01 giả: băm ổn định, khác tài liệu cũ, có đủ dữ kiện câu hỏi chính sách", () => {
    expect(policyHash()).toBe(policyHash());
    expect(policyHash()).not.toBe(docHash());
    const all = POLICY_CHUNKS.map((c) => `${c.heading} ${c.body}`).join(" ");
    for (const fact of [
      "500 triệu",
      "Giám đốc",
      "30 ngày",
      "Bao Bì Minh Phát",
      "15 ngày",
      "300 triệu",
    ])
      expect(all).toContain(fact);
    expect(POLICY_TITLE).toContain("QC-TC-01");
    expect(Object.keys(TIERED_AGENTS)).toEqual(["orchestrator", "assistant", "mgmt-assistant"]);
  });
  it("tên công ty mẫu là giả, không phải NITI; mọi đối tác có điện thoại + liên hệ", () => {
    expect(OWN.name).toBe("Công ty Demo");
    expect(JSON.stringify(PARTNERS)).not.toMatch(/niti/i);
    for (const r of companyRows("t")) {
      expect(r.phone).toBeTruthy();
      expect(r.contact_person).toBeTruthy();
    }
  });
});
