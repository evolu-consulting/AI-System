// CR-182 · lát cr182-migrate · chuông «Chưa giao người»: lượt mở từ sự kiện bị từ chối vì vai chưa giao (lát roles: `ROLE_UNASSIGNED` ⇒ lý do
// `FLOW_GROUP_MISSING:<khoá vai>`) ⇒ báo QUẢN TRỊ CÔNG TY (tenant_admin ∨ quyền `admin` gói Sổ Hợp Tác, còn dùng được; trần 50) để giao việc ở Cài đặt › Quy trình duyệt.
// Gọi trong tx chốt lô của bộ điều phối (hook `notLaunched`, mỗi hook có savepoint riêng ⇒ lỗi không làm hỏng lô). Chỉ hàng lỗi (ít) ⇒ không ảnh hưởng
// đường nóng. Số câu cố định mỗi sự kiện: nhãn vai 1 + người nhận 1 + (tên HĐ + chuông) 2 trong role gói. Mã khoá không phải vai (thiếu nhóm theo MÃ của
// mẫu Thư viện) ⇒ không tra được nhãn ⇒ không gửi chuông (lý do vẫn hiện trên thẻ HĐ như cũ). Chuông trùng (HĐ × vai) ⇒ `dedup_key` bỏ qua.
import { packFeatureKey } from "@ai/contracts/packs";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { withPackRoleInTx } from "../../kit/public";
import { CONTRACTS_PACK } from "../domain/contract-flow-events.rules";

export const ROLE_BELL_KIND = "contract.role_unassigned";
export const ROLE_BELL_LINK = "/contracts/settings?sec=flow";
export const ROLE_BELL_REASON = "FLOW_GROUP_MISSING:";
/** Vai người ký do migration 0160 / trình soạn đặt: `args.signer_role` lưu `{from,value}` (không có `label`) ⇒ nhãn cố định. */
export const SIGNER_ROLE_KEY = "nguoi-ky-hop-dong";
export const SIGNER_ROLE_LABEL = "Người ký hợp đồng";
const ADMINS_MAX = 50;
/** Quyền `admin` gói Sổ Hợp Tác (Q15: quản trị công ty = tenant_admin ∨ người có quyền này, trực tiếp hoặc qua nhóm). */
const PACK_ADMIN_FEATURE = packFeatureKey(CONTRACTS_PACK, "admin");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Khoá vai trong lý do `FLOW_GROUP_MISSING:k1,k2` (thuần); lý do khác ⇒ rỗng. */
export function roleKeysOfReason(reason: string): string[] {
  const raw = reason.startsWith(ROLE_BELL_REASON) ? reason.slice(ROLE_BELL_REASON.length) : "";
  return [
    ...new Set(
      raw
        .split(",")
        .map((k) => k.trim())
        .filter((k) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(k)),
    ),
  ].slice(0, 5);
}

/** Nội dung chuông (thuần): «Hợp đồng <tên> đang chờ: vai <nhãn> chưa giao người». */
export const roleBellBody = (contract: string, labels: readonly string[]): string =>
  `Hợp đồng ${contract} đang chờ: vai ${labels.join(", ")} chưa giao người.`.slice(0, 2000);

export async function bellRoleUnassigned(
  tx: Tx,
  i: { tenantId: string; ref: string; reason: string },
): Promise<number> {
  const keys = roleKeysOfReason(i.reason);
  if (keys.length === 0 || !UUID.test(i.ref) || !UUID.test(i.tenantId)) return 0;
  const labels = await tx.execute<{
    key: string;
    label: string;
  }>(sql`select distinct r ->> 'key' as key, r ->> 'label' as label
    from hub.process_defs d cross join lateral jsonb_path_query(d.stages, 'lax $.**.role') r
    where (d.tenant_id = ${i.tenantId}::uuid or d.tenant_id is null) and d.deleted_at is null and jsonb_typeof(d.stages) = 'array'
      and d.stages::text like '%"role"%' and jsonb_typeof(r) = 'object'
      and r ->> 'key' = any(array(select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)))
    order by 1 limit 10`);
  const found = new Map<string, string>(labels.map((l) => [l.key, l.label]));
  // Vai người ký ở `args.signer_role` ({from,value}) không có nhãn trong def ⇒ nhãn cố định; khoá tuỳ ý khác ⇒ `signer_role_label` của bước Ký, không có ⇒ tên bước.
  const rest = keys.filter((k) => !found.has(k));
  if (rest.includes(SIGNER_ROLE_KEY)) found.set(SIGNER_ROLE_KEY, SIGNER_ROLE_LABEL);
  const others = rest.filter((k) => k !== SIGNER_ROLE_KEY);
  if (others.length > 0) {
    const sg = await tx.execute<{
      key: string;
      label: string;
    }>(sql`select distinct on (key) st #>> '{executor,args,signer_role,value}' as key,
        coalesce(nullif(btrim(st #>> '{executor,args,signer_role_label,value}'), ''), nullif(btrim(st ->> 'name'), '')) as label
      from hub.process_defs d cross join lateral jsonb_array_elements(d.stages) st
      where (d.tenant_id = ${i.tenantId}::uuid or d.tenant_id is null) and d.deleted_at is null and jsonb_typeof(d.stages) = 'array'
        and d.stages::text like '%signer_role%' and jsonb_typeof(st) = 'object'
        and st #>> '{executor,args,signer_role,value}' = any(array(select jsonb_array_elements_text(${JSON.stringify(others)}::jsonb)))
        and coalesce(nullif(btrim(st #>> '{executor,args,signer_role_label,value}'), ''), nullif(btrim(st ->> 'name'), '')) is not null
      -- Cùng khoá vai ở nhiều quy trình: ưu tiên quy trình đang Bật của công ty (def của lượt), rồi ổn định theo id.
      order by key, exists (select 1 from hub.company_flows cf where cf.tenant_id = ${i.tenantId}::uuid and cf.flow_id = d.id and cf.enabled) desc, d.id
      limit 10`);
    for (const r of sg) found.set(r.key, r.label);
  }
  if (found.size === 0) return 0;
  const admins = await tx.execute<{ id: string }>(sql`select u.id::text as id from admin.users u
    where u.tenant_id = ${i.tenantId}::uuid and u.kind = 'internal' and u.active and not u.locked_by_tenant
      and (u.role = 'tenant_admin' or exists (select 1 from admin.feature_grants fg join admin.features f on f.id = fg.feature_id
        where fg.tenant_id = u.tenant_id and f.key = ${PACK_ADMIN_FEATURE} and f.status <> 'off'
          and (fg.user_id = u.id or fg.group_id in (select gm.group_id from admin.group_members gm
            where gm.tenant_id = u.tenant_id and gm.user_id = u.id))))
    order by u.id limit ${ADMINS_MAX}`);
  if (admins.length === 0) return 0;
  const names = [...new Set(found.values())];
  return withPackRoleInTx(tx, CONTRACTS_PACK, i.tenantId, async () => {
    const [c] = await tx.execute<{
      name: string | null;
    }>(sql`select coalesce(nullif(btrim(title), ''), nullif(btrim(number), '')) as name
      from contracts.contracts where id = ${i.ref}::uuid and tenant_id = ${i.tenantId}::uuid`);
    const rows = admins.map((a) => ({
      user_id: a.id,
      kind: ROLE_BELL_KIND,
      title: "Chưa giao người",
      body: roleBellBody(c?.name ?? "chưa đặt tên", names),
      link: ROLE_BELL_LINK,
      dedup_key: `role-unassigned:${i.ref}:${keys.join("+")}`.slice(0, 200),
    }));
    const [n] = await tx.execute<{ n: number }>(
      sql`select notify.enqueue('contracts', ${JSON.stringify(rows)}::jsonb) as n`,
    );
    return n?.n ?? 0;
  });
}
