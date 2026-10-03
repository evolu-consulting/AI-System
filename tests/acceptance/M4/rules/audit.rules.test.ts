// ADM-FR-51, ADM-FR-52, ADM-BR-09 · M4-R12, M4-R13 · hàm thuần `modules/audit/audit.rules.ts` (test-plan R16–R19;
// chữ ký plan-rules §A2–A3). Xanh ở T2. Module nạp động (`_modules.ts`): trước T2 mỗi ca đỏ vì "Cannot find module".
import { describe, expect, it } from "bun:test";
import { loadAuditRules } from "../_modules";

const R = () => loadAuditRules();
const A = "01900000-0000-7000-8000-000000000101";
const B = "01900000-0000-7000-8000-000000000102";

const RESTORABLE = ["command", "workflow", "feature", "group", "quota"];
const OTHER_ENTITIES = ["tenant", "user", "user_totp", "grant", "entitlement", "secret", "config"];
const RESTORE_ACTIONS = ["update", "delete", "restore"];
const OTHER_ACTIONS = ["create", "lock", "unlock", "grant", "revoke", "import"];
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("ADM-FR-51 · ADM-BR-09 · M4-R12 · resolveAuditFilter", () => {
  it("ADM-BR-09 · M4-R12 · tenant_admin: vắng/own → tenant mình; tenant khác / 'system' → 'not_found'", async () => {
    const { resolveAuditFilter } = await R();
    const ta = { role: "tenant_admin", tenantId: A };
    expect(resolveAuditFilter(ta, undefined)).toEqual({ kind: "tenant", tenantId: A });
    expect(resolveAuditFilter(ta, A)).toEqual({ kind: "tenant", tenantId: A });
    expect(resolveAuditFilter(ta, B)).toBe("not_found");
    expect(resolveAuditFilter(ta, "system")).toBe("not_found");
  });

  it("ADM-FR-51 · M4-R12 · platform_admin: vắng → all; 'system' → system; uuid → tenant", async () => {
    const { resolveAuditFilter } = await R();
    const pa = { role: "platform_admin", tenantId: B };
    expect(resolveAuditFilter(pa, undefined)).toEqual({ kind: "all" });
    expect(resolveAuditFilter(pa, "system")).toEqual({ kind: "system" });
    expect(resolveAuditFilter(pa, A)).toEqual({ kind: "tenant", tenantId: A });
  });
});

describe("ADM-FR-52 · M4-R13 · Q7 · Q8 · canRestore", () => {
  it("ADM-FR-52 · M4-R13 · platform × 5 entity × {update, delete, restore} × snapshot → true (15 ca)", async () => {
    const { canRestore } = await R();
    let n = 0;
    for (const entity of RESTORABLE)
      for (const action of RESTORE_ACTIONS) {
        expect([
          entity,
          action,
          canRestore("platform_admin", { entity, action, snapshot: true }),
        ]).toEqual([entity, action, true]);
        n++;
      }
    expect(n).toBe(15);
  });

  it("ADM-FR-52 · M4-R13 · Q7 · snapshot false / 7 entity khác / 6 action khác → false", async () => {
    const { canRestore } = await R();
    for (const entity of RESTORABLE)
      expect(canRestore("platform_admin", { entity, action: "update", snapshot: false })).toBe(
        false,
      );
    for (const entity of OTHER_ENTITIES)
      expect([
        entity,
        canRestore("platform_admin", { entity, action: "update", snapshot: true }),
      ]).toEqual([entity, false]);
    for (const action of OTHER_ACTIONS)
      expect([
        action,
        canRestore("platform_admin", { entity: "command", action, snapshot: true }),
      ]).toEqual([action, false]);
  });

  it("ADM-FR-52 · M4-R13 · Q8 · tenant_admin (và member) → false kể cả group/update/snapshot", async () => {
    const { canRestore } = await R();
    for (const role of ["tenant_admin", "member"])
      for (const entity of RESTORABLE)
        expect(canRestore(role, { entity, action: "update", snapshot: true })).toBe(false);
  });
});

describe("ADM-FR-52 · M4-R13 · restoreCheck", () => {
  it("ADM-FR-52 · M4-R13 · update/restore: không tồn tại → NOT_RESTORABLE; version lệch → VERSION_CONFLICT; khớp → ok", async () => {
    const { restoreCheck } = await R();
    for (const action of ["update", "restore"]) {
      expect(restoreCheck({ action, entityVersion: 43 }, { exists: false, version: null })).toBe(
        "NOT_RESTORABLE",
      );
      expect(restoreCheck({ action, entityVersion: 43 }, { exists: true, version: 44 })).toBe(
        "VERSION_CONFLICT",
      );
      expect(restoreCheck({ action, entityVersion: 43 }, { exists: true, version: 43 })).toBe("ok");
    }
  });

  it("ADM-FR-52 · M4-R13 · delete: thực thể còn → NOT_RESTORABLE; không còn → ok", async () => {
    const { restoreCheck } = await R();
    expect(
      restoreCheck({ action: "delete", entityVersion: null }, { exists: true, version: 1 }),
    ).toBe("NOT_RESTORABLE");
    expect(
      restoreCheck({ action: "delete", entityVersion: null }, { exists: false, version: null }),
    ).toBe("ok");
  });
});

describe("ADM-FR-51 · M4-R12 · cursor", () => {
  it("ADM-FR-51 · M4-R12 · encodeCursor/decodeCursor khứ hồi '1' và '9007199254740993' (vượt 2^53, không mất chính xác)", async () => {
    const { encodeCursor, decodeCursor } = await R();
    for (const seq of ["1", "9007199254740993"]) {
      const c = encodeCursor(seq) as string;
      expect(c.length).toBeLessThanOrEqual(32);
      expect(decodeCursor(c)).toBe(seq);
    }
  });

  it("ADM-FR-51 · M4-R12 · cursor không hợp lệ → null: '!!', '', base64 của 'abc', base64 của '-1'", async () => {
    const { decodeCursor } = await R();
    for (const bad of ["!!", "", b64url("abc"), b64url("-1")]) {
      expect([bad, decodeCursor(bad)]).toEqual([bad, null]);
    }
  });
});
