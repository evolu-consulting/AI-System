// N3-FR-08 · N3-NFR-02 · secret SMTP/VAPID qua kho secret Hub: nền tảng (tenant_id NULL), mã hóa AES-GCM, đọc qua `HubSecretReader`,
// không rò ra bảng thông báo/log. DB thật; khóa là khóa thử sinh ngẫu nhiên.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { hubCredentials } from "../../../apps/hub-api/src/modules/notify/adapters/credentials";
import {
  parseHubSecretsKey,
  sealHubSecret,
} from "../../../apps/hub-api/src/modules/secrets/secrets.crypto";
import {
  HubSecretReader,
  isSecretUseError,
} from "../../../apps/hub-api/src/modules/secrets/secrets.use";
import { HUB_API_URL, needNotify, pgCode, type Sql, setupX2a, T } from "./_support/n3";

let sql: Sql;
let db: ReturnType<typeof connectDb>;
const key = parseHubSecretsKey(randomBytes(32).toString("base64"));
const warns: unknown[][] = [];
const reader = () =>
  new HubSecretReader({ db, key, log: { warn: (...a: unknown[]) => void warns.push(a) } as never });

beforeAll(async () => {
  sql = await setupX2a();
  await needNotify(sql);
  db = connectDb(HUB_API_URL, 3);
});
afterAll(async () => {
  await db.close();
  await sql.end();
});

async function putSecret(
  kind: string,
  value: string,
  tenantId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  const s = sealHubSecret(key, { id, kind: kind as never, tenantId }, value);
  await sql`delete from hub.secrets where kind = ${kind} and tenant_id is not distinct from ${tenantId}`;
  await sql`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, key_version)
    values (${id}, ${kind}, ${tenantId}, ${`n3-${kind}`}, ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.iv)}, ${s.keyVersion})`;
  return id;
}

describe("N3-FR-08 · kind secret của cổng thông báo", () => {
  it("smtp_password / vapid_private_key chỉ là secret NỀN TẢNG: gắn tenant ⇒ 23514 (CHECK)", async () => {
    for (const kind of ["smtp_password", "vapid_private_key"]) {
      expect(await pgCode(() => putSecret(kind, "x".repeat(12)))).toBeNull();
      const code = await pgCode(() => putSecret(kind, "x".repeat(12), T.acme));
      expect({ kind, code }).toEqual({ kind, code: "23514" });
    }
  });

  it("đọc qua kho: giải mã đúng giá trị, chỉ trong callback; chưa cấu hình ⇒ SecretUseError secret_missing, log không chứa giá trị", async () => {
    await sql`delete from hub.secrets where kind in ('smtp_password', 'vapid_private_key')`;
    const creds = hubCredentials(db, reader());
    const miss = await creds.use("smtp_password", async (v) => v).catch((e) => e);
    expect(isSecretUseError(miss)).toBe(true);
    expect((miss as { failure: string }).failure).toBe("secret_missing");

    await putSecret("smtp_password", "mat-khau-smtp-123");
    expect(await creds.use("smtp_password", async (v) => v.length)).toBe(
      "mat-khau-smtp-123".length,
    );
    expect(await creds.use("smtp_password", async (v) => v)).toBe("mat-khau-smtp-123");
    expect(JSON.stringify(warns)).not.toContain("mat-khau-smtp-123");
    // kind khác không đọc nhầm secret này
    const other = await creds.use("vapid_private_key", async (v) => v).catch((e) => e);
    expect((other as { failure: string }).failure).toBe("secret_missing");
  });

  it("hub_rw không SELECT được bản mã (ciphertext) — cổng thông báo không có đường đọc thẳng", async () => {
    await putSecret("smtp_password", "mat-khau-smtp-123");
    const code = await pgCode(async () => {
      const conn = (await import("postgres")).default(HUB_API_URL, { max: 1, onnotice: () => {} });
      try {
        await conn.begin(async (tx) => {
          await tx`select set_config('app.scope', 'system', true)`;
          await tx`select ciphertext from hub.secrets limit 1`;
        });
      } finally {
        await conn.end({ timeout: 1 });
      }
    });
    expect(code).toBe("42501");
  });
});
