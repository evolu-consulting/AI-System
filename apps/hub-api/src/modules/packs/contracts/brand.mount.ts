// CR-110 · COM-FR-45 · ADR-0031: cổng đọc brand công ty `CompanyBrandReader` (lớp 4) — `community-wire.mount.ts` tiêm vào community.
// MỘT câu, văn bản cố định: tên = `admin.tenants.name` của tenant phiên (CR-121 c20, `contracts.tenant_name()`), còn tên ứng dụng/logo/màu
// từ `contracts.company_settings` — không pháp nhân/MST/cờ.
// Tx hệ thống của gói (`userId` null ⇒ RLS tenant theo `app.tenant_id` vẫn áp, `ext_deny` không chặn) vì đối tác cũng phải đọc
// được brand chủ quản; quyền vào community đã kiểm ở route, `tenantId` luôn từ token.
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { createPackUow } from "../kit/public";
import { one } from "./adapters/ledger-sql";

const KEY = "contracts";

type BrandRow = {
  name: string | null;
  appName: string | null;
  logo: string | null;
  accent: string;
};
type BrandReader = {
  brand(tenantId: string): Promise<BrandRow | null>;
  /** CR-138 Q9: ảnh bìa công ty (data URL) hoặc null — tách khỏi `brand` để không kéo ảnh to vào mỗi lần tải app. */
  cover(tenantId: string): Promise<string | null>;
  /** CR-147b: chủ sở hữu đổi/xoá ảnh bìa (cùng cột CR-138; gọi sau khi route đã kiểm `caps.admin`). */
  setCover(tenantId: string, actorUserId: string, cover: string | null): Promise<void>;
};

const brandOf = (tx: Tx, tid: string): Promise<BrandRow | null> =>
  one<BrandRow | null>(
    tx,
    sql`select jsonb_build_object('name', contracts.tenant_name(), 'appName', s.app_name, 'logo', s.logo, 'accent', s.accent) as j
      from contracts.company_settings s where s.tenant_id = ${tid}::uuid`,
  );

/** Chỉ cột `cover` (+ `updated_by` = người đổi, cùng cơ chế nhật ký của company_settings); chưa có hàng ⇒ tạo hàng với mặc định cột (accent indigo, theme auto) — như lần lưu đầu. */
const setCoverOf = async (
  tx: Tx,
  tid: string,
  actor: string,
  cover: string | null,
): Promise<void> => {
  await tx.execute(
    sql`insert into contracts.company_settings as s (tenant_id, cover, updated_by) values (${tid}::uuid, ${cover}, ${actor}::uuid)
      on conflict (tenant_id) do update set cover = excluded.cover, version = s.version + 1,
        updated_by = excluded.updated_by, updated_at = now()`,
  );
};

const coverOf = (tx: Tx, tid: string): Promise<string | null> =>
  one<{ cover: string | null } | null>(
    tx,
    sql`select jsonb_build_object('cover', s.cover) as j from contracts.company_settings s where s.tenant_id = ${tid}::uuid`,
  ).then((r) => r?.cover ?? null);

export function companyBrandModule(db: Db): BrandReader {
  const uow = createPackUow(db, KEY, (tx, t) => ({
    brand: () => brandOf(tx, t),
    cover: () => coverOf(tx, t),
    setCover: (actor: string, cover: string | null) => setCoverOf(tx, t, actor, cover),
  }));
  return {
    brand: (tenantId) => uow.system(tenantId, (r) => r.brand()),
    cover: (tenantId) => uow.system(tenantId, (r) => r.cover()),
    setCover: (tenantId, actor, cover) => uow.system(tenantId, (r) => r.setCover(actor, cover)),
  };
}
