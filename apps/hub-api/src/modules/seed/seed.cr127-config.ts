// CR-127 · Z0 · rule D7 · phần CR-127 của cấu hình công ty MỚI (tách khỏi seed.cr125-config.ts cho đủ ≤ 400 dòng; `writeCr125Config` gọi):
//   nhóm «Người ký HĐ» (`TEMPLATE_GROUPS`) ⇒ `partner_settings.signer_group_id` (người ký khi Đồng ý ký cùng lúc).
// Mẫu Thư viện của app Hợp đồng KHÔNG còn seed (người dùng chốt 2026-11-10 «chỉ cho tạo flow trống»; hub 0136 lưu trữ 11 mẫu).
// CHỈ công ty có tên trong `keys` (công ty mới / fixture). Idempotent, mỗi bước MỘT câu SQL theo tập.
import type { Tx } from "./seed.repo";

/** Nhóm người ký phía công ty (seed demo): mã nhóm cố định, thành viên mẫu ở `seed.cr125-members`. */
export const SIGNER_GROUP_KEY = "nguoi-ky-hd";
export const SIGNER_GROUP = {
  key: SIGNER_GROUP_KEY,
  name: { vi: "Người ký HĐ", en: "Contract signers" },
} as const;

/**
 * Công ty có `contracts-read` và nhóm «Người ký HĐ» ⇒ `partner_settings.signer_group_id` (tạo dòng nếu chưa có; ngưỡng mức quan trọng giữ mặc định
 * của bảng). Đã chọn nhóm (kể cả admin đã đổi) ⇒ giữ nguyên. Gói Hợp đồng chưa có bảng ⇒ bỏ qua.
 */
export async function writeSignerGroup(tx: Tx, keys: readonly string[]): Promise<number> {
  const [has] = await tx`select to_regclass('contracts.partner_settings') is not null as ok`;
  if (!has?.ok) return 0;
  const [col] = await tx`select exists (select 1 from information_schema.columns
    where table_schema = 'contracts' and table_name = 'partner_settings' and column_name = 'signer_group_id') as ok`;
  if (!col?.ok) return 0;
  return (
    await tx`insert into contracts.partner_settings (tenant_id, signer_group_id)
      select tn.id, g.id
      from admin.tenants tn
      join admin.groups g on g.tenant_id = tn.id and g.key = ${SIGNER_GROUP_KEY}
      where tn.key = any(${[...keys]}::text[]) and tn.active
        and exists (select 1 from admin.feature_entitlements en join admin.features f on f.id = en.feature_id
          where en.tenant_id = tn.id and en.revoked_at is null and f.key = 'contracts-read' and f.status <> 'off')
      on conflict (tenant_id) do update set signer_group_id = excluded.signer_group_id, updated_at = now()
        where contracts.partner_settings.signer_group_id is null
      returning tenant_id`
  ).length;
}
