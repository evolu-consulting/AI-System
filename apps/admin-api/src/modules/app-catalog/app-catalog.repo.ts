// app-catalog · truy vấn admin.app_catalog (catalog toàn hệ thống, ≤ vài chục hàng): mỗi hàm một câu SQL cố định.
import type { AppAudience, AppCreateRequest, AppUpdateRequest } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { CatalogRow } from "./app-catalog.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export type CatalogDbRow = CatalogRow & { version: number; updatedAt: Date };

type Raw = {
  key: string;
  name: unknown;
  icon: string;
  url: string;
  audience: AppAudience;
  required_feature: string | null;
  sso: boolean;
  sort_order: number;
  enabled: boolean;
  version: number;
  updated_at: Date | string;
};

const COLS = sql.raw(
  "key, name, icon, url, audience, required_feature, sso, sort_order, enabled, version, updated_at",
);

function toRow(r: Raw): CatalogDbRow {
  const name = r.name as { vi?: unknown; en?: unknown };
  if (typeof name?.vi !== "string") throw new Error(`app_catalog: name hỏng ở hàng ${r.key}`);
  return {
    key: r.key,
    name: typeof name.en === "string" ? { vi: name.vi, en: name.en } : { vi: name.vi },
    icon: r.icon,
    url: r.url,
    audience: r.audience,
    requiredFeature: r.required_feature,
    sso: r.sso,
    sortOrder: r.sort_order,
    enabled: r.enabled,
    version: r.version,
    updatedAt: new Date(r.updated_at),
  };
}

export async function listAll(tx: Tx): Promise<CatalogDbRow[]> {
  const rows = await run<Raw>(
    tx,
    sql`select ${COLS} from admin.app_catalog order by sort_order, key`,
  );
  return rows.map(toRow);
}

export async function findOne(tx: Tx, key: string): Promise<CatalogDbRow | null> {
  const rows = await run<Raw>(tx, sql`select ${COLS} from admin.app_catalog where key = ${key}`);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Chèn hàng mới; trùng key ⇒ null. */
export async function insert(
  tx: Tx,
  b: AppCreateRequest,
  actorId: string,
): Promise<CatalogDbRow | null> {
  const rows = await run<Raw>(
    tx,
    sql`insert into admin.app_catalog (key, name, icon, url, audience, required_feature, sso, sort_order, enabled, updated_by)
      values (${b.key}, ${JSON.stringify(b.name)}::jsonb, ${b.icon}, ${b.url}, ${b.audience}, ${b.required_feature},
        ${b.sso}, ${b.sort_order}, ${b.enabled}, ${actorId}::uuid)
      on conflict (key) do nothing returning ${COLS}`,
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Cập nhật một phần (coalesce: trường vắng giữ nguyên; `required_feature` null có nghĩa xoá nên dùng cờ riêng). */
export async function update(
  tx: Tx,
  key: string,
  b: AppUpdateRequest,
  actorId: string,
): Promise<CatalogDbRow | null> {
  const rf = "required_feature" in b;
  const rows = await run<Raw>(
    tx,
    sql`update admin.app_catalog set
        name = coalesce(${b.name === undefined ? null : JSON.stringify(b.name)}::jsonb, name),
        icon = coalesce(${b.icon ?? null}, icon),
        url = coalesce(${b.url ?? null}, url),
        audience = coalesce(${b.audience ?? null}, audience),
        required_feature = case when ${rf} then ${b.required_feature ?? null} else required_feature end,
        sso = coalesce(${b.sso ?? null}::boolean, sso),
        sort_order = coalesce(${b.sort_order ?? null}::integer, sort_order),
        enabled = coalesce(${b.enabled ?? null}::boolean, enabled),
        version = version + 1, updated_at = now(), updated_by = ${actorId}::uuid
      where key = ${key} returning ${COLS}`,
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function remove(tx: Tx, key: string): Promise<boolean> {
  const rows = await run<{ key: string }>(
    tx,
    sql`delete from admin.app_catalog where key = ${key} returning key`,
  );
  return rows.length > 0;
}

export type DefaultApp = Pick<
  CatalogRow,
  "key" | "name" | "icon" | "audience" | "requiredFeature" | "sso" | "sortOrder"
>;

/**
 * Khởi động: (1) bảng RỖNG hoàn toàn (DB mới / test đã xoá) ⇒ chèn các app mặc định; (2) điền URL cho hàng còn rỗng từ env
 * (không đè giá trị admin đã sửa). Hai câu cố định. Trả số hàng đã chèn + điền.
 */
export async function seedDefaults(
  tx: Tx,
  defaults: readonly DefaultApp[],
  urls: Record<string, string>,
): Promise<number> {
  const ins = await run<{ key: string }>(
    tx,
    sql`insert into admin.app_catalog (key, name, icon, audience, required_feature, sso, sort_order)
      select x.key, x.name, x.icon, x.audience, x.required_feature, x.sso, x.sort_order
      from jsonb_to_recordset(${JSON.stringify(defaults.map(toSeedJson))}::jsonb)
        as x(key text, name jsonb, icon text, audience text, required_feature text, sso boolean, sort_order integer)
      where not exists (select 1 from admin.app_catalog)
      returning key`,
  );
  const upd = await run<{ key: string }>(
    tx,
    sql`update admin.app_catalog c set url = x.url, updated_at = now()
      from jsonb_each_text(${JSON.stringify(urls)}::jsonb) as x(key, url)
      where c.key = x.key and c.url = '' and x.url <> '' returning c.key`,
  );
  return ins.length + upd.length;
}

const toSeedJson = (d: DefaultApp) => ({
  key: d.key,
  name: d.name,
  icon: d.icon,
  audience: d.audience,
  required_feature: d.requiredFeature,
  sso: d.sso,
  sort_order: d.sortOrder,
});
