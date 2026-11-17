// CR-181 · lát s2 · adapter cài cổng `SignatureStore`: MỘT transaction scope người dùng (`withHubScope`) gom repo hàm DEFINER, audit (`HubAuditWriter`),
// chuông (`notify.enqueue`) và khoá advisory. Lỗi DB đặc thù của hàm quản trị đổi sang `SignatureError` ở đây (application không biết SQLSTATE).
import type { Role } from "@ai/contracts/common";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { dbHubAudit, type HubAuditWriter } from "../../../lib/hub-audit";
import type { Actor, SignatureStore, SignatureTx } from "../application/ports";
import { SignatureError } from "../domain/signature.error";
import { signaturesRepo } from "./signatures.repo";

/** Mã SQLSTATE của lỗi DB (Drizzle bọc lỗi postgres.js ở `cause`). */
function pgCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; e && typeof e === "object" && i < 5; i++) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

function txOf(tx: Tx, u: Actor, audit: HubAuditWriter): SignatureTx {
  const base = signaturesRepo(tx);
  return {
    repo: {
      ...base,
      grantChangeAsAdmin: (userId) =>
        base.grantChangeAsAdmin(userId).catch((e: unknown) => {
          const code = pgCode(e);
          if (code === "P0002")
            throw new SignatureError("SIGNATURE_USER_NOT_FOUND", 404, "User not found");
          if (code === "42501")
            throw new SignatureError("SIGNATURE_SELF_GRANT", 403, "Admins cannot grant themselves");
          throw e;
        }),
    },
    async who() {
      const [r] = await tx.execute<{ username: string; name: string }>(
        sql`select username, coalesce(nullif(display_name, ''), username) as name from admin.users
          where id = ${u.userId}::uuid and tenant_id = ${u.tenantId}::uuid`,
      );
      return { username: r?.username ?? null, name: r?.name ?? "" };
    },
    async lockSignature(kind) {
      // Cùng khoá với `hub.sig_create` (0155): hashtextextended(tenant:user:kind, 181).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${u.tenantId}::text || ':' || ${u.userId}::text || ':' || ${kind}::text, 181))`,
      );
    },
    async audit(e) {
      const [r] = await tx.execute<{ username: string }>(
        sql`select username from admin.users where id = ${u.userId}::uuid and tenant_id = ${u.tenantId}::uuid`,
      );
      await audit.insert(tx, {
        tenantId: u.tenantId,
        actorId: u.userId,
        actorUsername: r?.username ?? null,
        actorRole: u.role as Role,
        entity: "signature",
        hubConfigVersion: null,
        summary: {},
        ...e,
      });
    },
    async bell(rows) {
      if (rows.length === 0) return;
      await tx.execute(sql`select notify.enqueue('hub', ${JSON.stringify(rows)}::jsonb)`);
    },
  };
}

export function signatureStore(db: Db, audit: HubAuditWriter = dbHubAudit): SignatureStore {
  return {
    run: (u, fn) =>
      withHubScope(db, { kind: "user", tenantId: u.tenantId, userId: u.userId }, (tx) =>
        fn(txOf(tx, u, audit)),
      ),
  };
}
