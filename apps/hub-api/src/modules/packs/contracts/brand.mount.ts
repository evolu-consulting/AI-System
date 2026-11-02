// CR-110 · COM-FR-45 · ADR-0031: cổng đọc brand công ty `CompanyBrandReader` (lớp 4) — `community-wire.mount.ts` tiêm vào community.
// MỘT câu, văn bản cố định, đúng 4 cột (tên, tên ứng dụng, logo, màu) của `contracts.company_settings` — không pháp nhân/MST/cờ.
// Tx hệ thống của gói (`userId` null ⇒ RLS tenant theo `app.tenant_id` vẫn áp, `ext_deny` không chặn) vì đối tác cũng phải đọc
// được brand chủ quản; quyền vào community đã kiểm ở route, `tenantId` luôn từ token.
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { createPackUow } from "../kit/adapters/pack-uow";
import { one } from "./adapters/ledger-sql";

const KEY = "contracts";

type BrandRow = {
  name: string | null;
  appName: string | null;
  logo: string | null;
  accent: string;
};
type BrandReader = { brand(tenantId: string): Promise<BrandRow | null> };

const brandOf = (tx: Tx, tid: string): Promise<BrandRow | null> =>
  one<BrandRow | null>(
    tx,
    sql`select jsonb_build_object('name', s.company_name, 'appName', s.app_name, 'logo', s.logo, 'accent', s.accent) as j
      from contracts.company_settings s where s.tenant_id = ${tid}::uuid`,
  );

export function companyBrandModule(db: Db): BrandReader {
  const uow = createPackUow(db, KEY, (tx, t) => ({ brand: () => brandOf(tx, t) }));
  return { brand: (tenantId) => uow.system(tenantId, (r) => r.brand()) };
}
