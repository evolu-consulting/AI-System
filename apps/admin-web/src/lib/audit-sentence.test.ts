// ADM-FR-51, ADM-FR-41 · câu nhật ký: chọn key theo (entity, action, summary).
import { describe, expect, test } from "bun:test";
import type { AuditItem } from "@ai/contracts";
import { auditSentence } from "./audit-sentence";

const t = (key: string, p?: Record<string, string | number>) =>
  `${key}|${Object.entries(p ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;

const item = (over: Partial<AuditItem>): AuditItem => ({
  id: "00000000-0000-4000-8000-000000000001",
  at: "2026-10-03T03:00:00.000Z",
  tenant_id: null,
  tenant_key: null,
  actor_id: "00000000-0000-4000-8000-0000000000a1",
  actor_username: "admin",
  action: "update",
  entity: "command",
  entity_id: "00000000-0000-4000-8000-0000000000e1",
  entity_name: "/dich",
  config_version: 43,
  entity_version: 2,
  summary: {},
  restorable: false,
  ...over,
});

describe("auditSentence", () => {
  test("sửa command", () => {
    expect(auditSentence(item({}), t)).toContain(
      "actor=admin,entityType=audit.entity.command|,name=/dich",
    );
  });
  test("chọn key theo ngữ cảnh", () => {
    const key = (o: Partial<AuditItem>) => auditSentence(item(o), t).split("|")[0];
    expect(key({ entity: "secret" })).toBe("audit.sentence.secret");
    expect(key({ entity: "grant", action: "grant" })).toBe("audit.sentence.grant");
    expect(key({ action: "import", entity: "config" })).toBe("audit.sentence.import");
    expect(key({ action: "restore" })).toBe("audit.sentence.restore");
    expect(key({ entity: "quota" })).toBe("audit.sentence.quota");
    expect(key({ entity: "group", summary: { added: ["a"] } })).toBe("audit.sentence.members");
    expect(key({ entity: "user", summary: { password_reset: true } })).toBe(
      "audit.sentence.passwordReset",
    );
  });
  test("2FA: tắt hộ vs tự tắt", () => {
    const id = "00000000-0000-4000-8000-0000000000a1";
    const key = (o: Partial<AuditItem>) =>
      auditSentence(item({ entity: "user_totp", action: "delete", ...o }), t).split("|")[0];
    expect(key({ entity_id: id })).toBe("audit.sentence.totpOffSelf");
    expect(key({})).toBe("audit.sentence.totpOff");
    expect(key({ action: "create" })).toBe("audit.sentence.totpOn");
  });
  test("không có actor → Hệ thống", () => {
    expect(auditSentence(item({ actor_username: null }), t)).toContain(
      "actor=audit.sentence.system|",
    );
  });
});
