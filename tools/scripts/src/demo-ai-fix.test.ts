// Demo · demo-ai-fix + seed-demo-v2: chỉ tenant demo, tên công ty giả, đối tác mẫu đều có điện thoại + liên hệ.
import { describe, expect, it } from "bun:test";
import { assertDemo, DOC_CHUNKS, docHash } from "./demo-ai-fix";
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
  it("tên công ty mẫu là giả, không phải NITI; mọi đối tác có điện thoại + liên hệ", () => {
    expect(OWN.name).toBe("Công ty Demo");
    expect(JSON.stringify(PARTNERS)).not.toMatch(/niti/i);
    for (const r of companyRows("t")) {
      expect(r.phone).toBeTruthy();
      expect(r.contact_person).toBeTruthy();
    }
  });
});
