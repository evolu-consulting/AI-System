// CR-121 c21 (D4) · cấu hình gửi mail có MỘT nguồn = kho secret Hub: secret nền tảng (tenant_id NULL) kind `smtp_password`, giá trị là
// JSON `{host, port, secure, user, from, password}` (mã hoá AES-GCM như mọi secret; không thêm kind ⇒ không migration).
// Env `HUB_SMTP_*` + `SMTP_PASSWORD` chỉ KHỞI TẠO một lần (`seedMailSecret`): kho chưa có secret mail ⇒ chép từ env; đã có ⇒ giữ nguyên,
// KHÔNG ghi đè. Mọi chỗ gửi mail đọc qua `mailConfigReader` (không đọc env). Giá trị secret không log, không đưa vào lỗi.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../../lib/db";
import type { NotifyCredentials } from "./credentials";
import type { SmtpConfig } from "./smtp.transport";

export type MailConfig = { smtp: SmtpConfig; password: string };

/** Tên hàng secret do seed tạo (duy nhất theo kind + nền tảng — `secrets_name_uq`). */
export const MAIL_SECRET_NAME = "mail-config";
const MAIL_KIND = "smtp_password" as const;
/** Khoá advisory (hằng) tuần tự hoá seed giữa nhiều instance Hub khởi động cùng lúc. */
const SEED_LOCK = 21_040_301;

const MailConfigSchema = z.strictObject({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().max(254),
  from: z.string().min(3).max(320),
  password: z.string().max(1024),
});

/** Giá trị kho không phải JSON cấu hình hợp lệ (message cố định, không chứa giá trị). */
export class MailConfigInvalid extends Error {
  readonly code = "NOT_CONFIGURED";
  constructor() {
    super("notify: mail_config_invalid");
    this.name = "MailConfigInvalid";
  }
}

export const encodeMailConfig = ({ smtp: s, password }: MailConfig): string =>
  JSON.stringify({
    host: s.host,
    port: s.port,
    secure: s.secure,
    user: s.user,
    from: s.from,
    password,
  });

export function parseMailConfig(raw: string): MailConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new MailConfigInvalid();
  }
  const r = MailConfigSchema.safeParse(json);
  if (!r.success) throw new MailConfigInvalid();
  const { password, ...smtp } = r.data;
  return { smtp, password };
}

/** Đọc cấu hình mail từ kho secret Hub (mỗi lần gọi: một tra id + một đọc bản mã). Chưa có ⇒ `SecretUseError("secret_missing")`. */
export const mailConfigReader = (creds: NotifyCredentials) => (): Promise<MailConfig> =>
  creds.use(MAIL_KIND, async (v) => parseMailConfig(v));

export type MailSeedResult = "seeded" | "exists";

/** Mã hoá giá trị với danh tính (id, kind, tenant) — do nơi dựng truyền vào (`sealHubSecret` + khoá Hub), tránh import chéo module. */
export type SealSecret = (
  meta: { id: string; kind: "smtp_password"; tenantId: null },
  value: string,
) => { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number };

/**
 * Khởi tạo MỘT lần: chưa có secret nền tảng `smtp_password` ⇒ chèn (id mới, mã hoá bằng khoá Hub); có rồi (bất kỳ tên) ⇒ không đụng.
 * Một câu `INSERT … WHERE NOT EXISTS` dưới khoá advisory của tx ⇒ nhiều instance cùng khởi động vẫn đúng một hàng.
 */
export async function seedMailSecret(
  db: Db,
  seal: SealSecret,
  seed: MailConfig,
): Promise<MailSeedResult> {
  const id = crypto.randomUUID();
  const s = seal({ id, kind: MAIL_KIND, tenantId: null }, encodeMailConfig(seed));
  const rows = await withHubScope(db, { kind: "system" }, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK})`);
    return tx.execute<{ id: string }>(sql`
      insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, key_version)
      select ${id}::uuid, ${MAIL_KIND}, null, ${MAIL_SECRET_NAME}, ${Buffer.from(s.ciphertext)}::bytea,
             ${Buffer.from(s.iv)}::bytea, ${s.keyVersion}
      where not exists (select 1 from hub.secrets where kind = ${MAIL_KIND} and tenant_id is null)
      returning id`);
  });
  return rows.length > 0 ? "seeded" : "exists";
}
