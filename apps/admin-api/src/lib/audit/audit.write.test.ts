// ADM-FR-51, ADM-BR-04 · M4-R10 · `auditOf` lọc before/after qua allowlist; `auditSnapshot` ném khi allowlist chứa
// khoá cấm (lỗi lập trình). Phần DB (`recordAudit`) ở lib/config/config-write.int.test.ts.
import { describe, expect, it } from "bun:test";
import { AUDIT_FIELDS, FORBIDDEN_AUDIT_KEYS } from "./audit.rules";
import { auditOf } from "./audit.write";

describe("ADM-FR-51 · auditOf", () => {
  it("lọc before/after theo allowlist, null giữ null, mặc định entityVersion null", () => {
    const row = auditOf("update", "tenant", {
      entityId: "t1",
      entityName: "acme",
      tenantId: "t1",
      before: { key: "acme", name: "A", version: 1, id: "t1", updated_at: "x" },
      after: null,
      summary: { note: "x" },
    });
    expect(row).toEqual({
      action: "update",
      entity: "tenant",
      entityId: "t1",
      entityName: "acme",
      tenantId: "t1",
      before: { key: "acme", name: "A", version: 1 },
      after: null,
      entityVersion: null,
      summary: { note: "x" },
      snapshot: undefined,
    });
  });

  it("ADM-BR-04 · secret: bỏ value/last4/ciphertext", () => {
    const row = auditOf("create", "secret", {
      entityId: null,
      entityName: "K",
      tenantId: null,
      before: null,
      after: { name: "K", note: "n", value: "sk-x", last4: "abcd", ciphertext: "c", iv: "i" },
    });
    expect(row.after).toEqual({ name: "K", note: "n" });
  });
});

describe("ADM-BR-04 · allowlist không chứa khoá cấm", () => {
  it("không entity nào có trường ∈ FORBIDDEN_AUDIT_KEYS", () => {
    for (const fields of Object.values(AUDIT_FIELDS)) {
      for (const f of fields) expect(FORBIDDEN_AUDIT_KEYS).not.toContain(f);
    }
  });
});
