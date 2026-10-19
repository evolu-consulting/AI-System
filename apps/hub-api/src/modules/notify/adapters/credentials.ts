// N3-FR-08 · secret của cổng thông báo (mật khẩu SMTP, khoá riêng VAPID) lấy từ kho secret Hub (`hub.secrets`, secret nền tảng
// tenant_id NULL, kind `smtp_password` / `vapid_private_key`) — không `.env` commit. Giá trị chỉ sống trong `fn` (HubSecretReader):
// không cache, không log, không đưa vào bản gửi/payload. Adapter transport thật (ADR-0027) nhận `NotifyCredentials`.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { HubSecretReader } from "../../secrets/secrets.use";

export type NotifySecretKind = "smtp_password" | "vapid_private_key";

export type NotifyCredentials = {
  /** Gọi `fn(value)` với giá trị secret nền tảng của `kind`; chưa cấu hình ⇒ ném `SecretUseError("secret_missing")`. */
  use<T>(kind: NotifySecretKind, fn: (value: string) => Promise<T>): Promise<T>;
};

export function hubCredentials(db: Db, reader: HubSecretReader): NotifyCredentials {
  return {
    async use(kind, fn) {
      // Chỉ cột id/kind/tenant (hub_rw không SELECT được bản mã); hàng nền tảng mới nhất của kind.
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ id: string }>(sql`
          select id from hub.secrets where kind = ${kind} and tenant_id is null order by updated_at desc, id limit 1`),
      );
      const id = rows[0]?.id;
      if (!id)
        return reader.useSecret(
          { id: "00000000-0000-0000-0000-000000000000", kind, tenantId: null },
          fn,
        );
      return reader.useSecret({ id, kind, tenantId: null }, fn);
    },
  };
}
