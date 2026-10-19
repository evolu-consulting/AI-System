// N2-FR-01…05 · hạ tầng int lát N2 (spec N2 §2): hub-api THẬT (khuôn P-d `startPd`, launcher thật, `processLoops:false`) +
// gói `pkdemo` bật cho acme qua admin-api thật (khuôn N1). Điều kiện tiền đề đỏ NGAY với lý do rõ (Luật 4c). Không `it(...)`.
import { expect } from "bun:test";
import { packGroupKey, packsPath, startAdminN1, untilHubSettles } from "../N1/_support/n1";
import { type CtxPd, type Json, noFeature, type Sql, startPd, T } from "../P-d/_support/pd";

export type CtxN2 = CtxPd & { admin: Awaited<ReturnType<typeof startAdminN1>> };

/** Hub P-d + `packs.pkdemo` + admin-api (bật/tắt gói). `processRunsPerTenant` vắng ⇒ trần đọc theo tenant (N2-FR-04). */
export async function startN2(o: { processRunsPerTenant?: number } = {}): Promise<CtxN2> {
  const c = await startPd({
    ...(o.processRunsPerTenant === undefined
      ? {}
      : { processRunsPerTenant: o.processRunsPerTenant }),
    extraDeps: { packs: { pkdemo: true } },
  });
  const admin = await startAdminN1(c.k);
  return {
    ...c,
    admin,
    stop: async () => {
      await admin.close();
      await c.stop();
    },
  };
}

/** Cột `admin.tenants.process_runs_max` (admin 0013). */
export async function needRunsMax(sql: Sql): Promise<void> {
  const [r] = await sql<{ ok: boolean }[]>`select exists (select 1 from information_schema.columns
    where table_schema = 'admin' and table_name = 'tenants' and column_name = 'process_runs_max') as ok`;
  if (!r?.ok) noFeature("cột admin.tenants.process_runs_max", "N2 T5");
}
/** CHECK `review_tasks_result_ck` có `reject` (hub 0041). */
export async function needReject(sql: Sql): Promise<void> {
  const [r] = await sql<{ ok: boolean }[]>`select exists (select 1 from pg_constraint
    where conname = 'review_tasks_result_ck' and pg_get_constraintdef(oid) like '%reject%') as ok`;
  if (!r?.ok) noFeature("task result reject (migration hub 0041)", "N2 T3");
}
/** Cột `pkdemo.items.run_id` (pkdemo 0002). */
export async function needPkRun(sql: Sql): Promise<void> {
  const [r] = await sql<{ ok: boolean }[]>`select exists (select 1 from information_schema.columns
    where table_schema = 'pkdemo' and table_name = 'items' and column_name = 'run_id') as ok`;
  if (!r?.ok) noFeature("cột pkdemo.items.run_id", "N2 T6");
}

export const setRunsMax = (sql: Sql, tenantId: string, n: number) =>
  sql`update admin.tenants set process_runs_max = ${n} where id = ${tenantId}`;

/** Bật `pkdemo` cho tenant + đưa user vào Group vai (`editor` = read+write) + chờ Hub nạp lại cache. */
export async function enablePk(
  c: CtxN2,
  tenantId: string,
  users: { id: string }[],
  role: "owner" | "editor" | "viewer" = "editor",
): Promise<void> {
  const r = await c.admin.call("PUT", packsPath(tenantId, "pkdemo"));
  expect({ enable: r.status }).toEqual({ enable: 200 });
  const [g] = await c.sql<{ id: string }[]>`select id from admin.groups
    where tenant_id = ${tenantId} and key = ${packGroupKey("pkdemo", role)}`;
  await c.sql`insert into admin.group_members ${c.sql(
    users.map((u) => ({ tenant_id: tenantId, group_id: g?.id as string, user_id: u.id })),
  )} on conflict do nothing`;
  await bumpBoth(c.sql, tenantId);
}

/** Tắt gói qua admin-api + bump cấu hình. */
export async function disablePk(c: CtxN2, tenantId: string): Promise<void> {
  const r = await c.admin.call("DELETE", packsPath(tenantId, "pkdemo"));
  expect({ disable: [200, 204].includes(r.status) }).toEqual({ disable: true });
  await bumpBoth(c.sql, tenantId);
}

async function bumpBoth(sql: Sql, tenantId: string): Promise<void> {
  const [r] = await sql<{ v: number }[]>`update admin.config_meta
    set config_version = config_version + 1 returning config_version as v`;
  await sql`select pg_notify('config_changed',
    json_build_object('v', ${r?.v ?? 1}::int, 'entity', 'group', 'tenant_id', ${tenantId}::text)::text)`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

/** Chờ `/pack/pkdemo/me` của `role` có `actions` mong muốn (tín hiệu nạp lại cache, không ngủ). */
export async function untilPkActions(
  c: CtxN2,
  role: Parameters<CtxPd["call"]>[0],
  want: string[],
): Promise<void> {
  const got = await untilHubSettles(
    c.hub as never,
    async () => (await c.call(role, "GET", "/pack/pkdemo/me"))?.json?.actions ?? [],
    (a: string[]) => JSON.stringify(a) === JSON.stringify(want),
  );
  expect(got).toEqual(want);
}

export const errCode = (r: { json: Json }) => r.json?.error?.code ?? null;
export const ACME = T.acme;
export const BETA = T.beta;
