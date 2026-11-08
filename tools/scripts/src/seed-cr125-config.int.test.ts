// CR-125 · cr125-seed · D7 (cấu hình công ty đủ trọn): chạy fixture `writeTenantFixtures` trên DB mới (công ty + người dùng + gói bật như
// stg-seed/dev-up làm) ⇒ MỌI mẫu Thư viện được gán cho công ty đều `templateReadiness` ready (tính năng, tool, nhóm đủ), ops-watch
// (flow_flag, tenant_profile, cấu hình duyệt HĐ + danh mục feature) không cảnh báo, chạy lần hai đổi 0 hàng. Dữ liệu giả, email @demo.local.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import { enablePack } from "../../../apps/admin-api/src/modules/packs/packs.service";
import {
  approvalConfigQuery,
  evaluateFlowCoverage,
  featureCatalogQuery,
} from "../../../apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check";
import {
  evaluateFlowFlag,
  flowFlagQuery,
} from "../../../apps/hub-api/src/modules/ops/adapters/checks/flow-flag.check";
import {
  evaluateTenantProfile,
  tenantProfileQuery,
} from "../../../apps/hub-api/src/modules/ops/adapters/checks/tenant-profile.check";
import type { PackToolCatalog } from "../../../apps/hub-api/src/modules/packs/kit/public";
import { readinessOf } from "../../../apps/hub-api/src/modules/processes/library/template-readiness";
import {
  APPROVAL_DEFAULT_FLOW_ID,
  DEMO_ESIGN_PROVIDER,
  RECEIVE_DEFAULT_FLOW_ID,
} from "../../../apps/hub-api/src/modules/seed/seed.cr125-config";
import { writeTenantFixtures } from "../../../apps/hub-api/src/modules/seed/seed.tenant-fixtures";

let sql: Sql;
let admin: Db;
let hub: Db;
const ids = new Map<string, string>();

// [công ty, username, vai] — người dùng giả, email @demo.local.
const U = [
  ["evolu", "julian.bui", "tenant_admin"],
  ["evolu", "thomas.tran", "member"],
  ["evolu", "vio.ngo", "member"],
  ["demo", "demo-owner", "tenant_admin"],
  ["demo", "demo-editor", "member"],
  ["demo", "demo-viewer", "member"],
] as const;

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  admin = createDb(withCreds(urls().owner, "admin_api", "admin_api_dev_pw"), { max: 3 });
  hub = createDb(urls().hubApi, { max: 3 });
  for (const key of ["evolu", "demo"]) {
    const id = crypto.randomUUID();
    ids.set(key, id);
    await sql`insert into admin.tenants (id, key, name, active) values (${id}, ${key}, ${`Công ty ${key} (giả)`}, true)`;
  }
  const rows = U.map(([t, username, role]) => ({
    id: crypto.randomUUID(),
    tenant_id: ids.get(t) as string,
    username,
    email: `${username}@demo.local`,
    password_hash: "x",
    display_name: username,
    role,
    locale: "en",
    must_change_password: false,
  }));
  await sql`insert into admin.users ${sql(rows)}`;
  // Đúng việc stg-seed / dev-up làm: bật hai gói qua service admin (tính năng, nhóm vai, grant).
  for (const t of ["evolu", "demo"]) {
    const [u] =
      await sql`select id from admin.users where tenant_id = ${ids.get(t) as string} and role = 'tenant_admin'`;
    const call = {
      ctx: { db: admin },
      scope: { kind: "platform" } as const,
      actor: { userId: (u as { id: string }).id },
    };
    await enablePack(call, ids.get(t) as string, "contracts");
    await enablePack(call, ids.get(t) as string, "community");
  }
}, 180_000);

afterAll(async () => {
  await hub?.close();
  await admin?.close();
  await sql?.end({ timeout: 2 });
});

const seed = () => sql.begin((tx) => writeTenantFixtures(tx, "development"));

/** Chỉ số chạm toàn bộ bảng seed ghi (đếm + dấu thời gian + phiên bản cấu hình) ⇒ chạy lại không đổi hàng nào. */
async function fingerprint(): Promise<string> {
  const [r] = await sql`select md5(concat_ws('|',
    (select count(*) from admin.groups), (select count(*) from admin.group_members), (select count(*) from admin.feature_entitlements),
    (select count(*) from hub.process_defs), (select count(*) from hub.process_def_releases), (select count(*) from hub.company_flows),
    (select coalesce(sum(extract(epoch from updated_at)), 0) from hub.company_flows),
    (select count(*) from hub.tenant_flow_settings),
    (select coalesce(sum(extract(epoch from updated_at)), 0) from hub.tenant_flow_settings),
    (select count(*) from contracts.approval_settings),
    (select coalesce(sum(extract(epoch from updated_at)), 0) from contracts.approval_settings),
    (select config_version from admin.config_meta), (select hub_config_version from hub.config_meta where id = 1))) as h`;
  return (r as { h: string }).h;
}

const sumOf = (o: unknown): number =>
  typeof o === "number"
    ? o
    : o && typeof o === "object"
      ? Object.values(o).reduce<number>((a, v) => a + sumOf(v), 0)
      : 0;

/** Tool của gói khả dụng khi công ty có `contracts-read` (cùng luật `PackToolRegistry.enabled`: gói bật ⇒ tool của gói dùng được). */
const packTools = {
  available: async (tenantId: string, keys?: readonly string[]) => {
    const [r] =
      await sql`select exists (select 1 from admin.feature_entitlements en join admin.features f on f.id = en.feature_id
      where en.tenant_id = ${tenantId} and en.revoked_at is null and f.key = 'contracts-read') as on`;
    return (r as { on: boolean }).on
      ? (keys ?? []).filter((k) => k.startsWith("contracts-")).map((key) => ({ key }))
      : [];
  },
} as unknown as PackToolCatalog;

describe("CR-125 · seed cấu hình công ty đủ trọn (D7)", () => {
  it("lần 1: tính năng, Ký thử, nhóm, mẫu Thư viện, flow mặc định, cờ flow_triggers đều có", async () => {
    const r = await seed();
    expect(r.cr125.features).toBeGreaterThan(0);
    expect(r.cr125.companyFlows).toBe(6); // 3 flow × 2 công ty
    expect(r.cr125.flowFlags).toBe(2);
    expect(r.cr125.libraryDefs).toBe(7); // 3 mẫu duyệt HĐ + Community + 3 mẫu «Quy trình mua hàng»
    const demo = ids.get("demo") as string;
    const [ps] =
      await sql`select esign_enabled, esign_default_provider from contracts.approval_settings where tenant_id = ${demo}`;
    expect(ps).toMatchObject({ esign_enabled: true, esign_default_provider: DEMO_ESIGN_PROVIDER });
    const feats =
      await sql`select 1 from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
      where e.tenant_id = ${demo} and e.revoked_at is null and f.key = 'contracts-partner-confirm'`;
    expect(feats.length).toBe(1);
    const owners = await sql`select g.key from admin.groups g where g.tenant_id = ${demo}
      and g.key in ('contracts-owner', 'community-owner', 'truong-phong', 'giam-doc', 'phong-kinh-doanh') order by 1`;
    expect(owners.map((x) => x.key)).toEqual([
      "community-owner",
      "contracts-owner",
      "giam-doc",
      "phong-kinh-doanh",
      "truong-phong",
    ]);
    const [han] =
      await sql`select count(*)::int as n from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
      where f.key = 'han-muc-duyet'`;
    expect((han as { n: number }).n).toBe(0);
  }, 120_000);

  it("mọi mẫu được gán cho công ty đều templateReadiness ready (tính năng, tool, nhóm đủ)", async () => {
    for (const t of ["evolu", "demo"]) {
      const tid = ids.get(t) as string;
      const flows = await sql`select d.id::text as id, d.key, d.stages from hub.company_flows cf
        join hub.process_defs d on d.id = cf.flow_id where cf.tenant_id = ${tid} and cf.enabled order by d.key`;
      expect(flows.map((f) => f.key)).toEqual([
        "community-duyet-bai",
        "hd-duyet-2-cap",
        "hd-nhan-thuong",
      ]);
      expect(flows.map((f) => f.id)).toContain(APPROVAL_DEFAULT_FLOW_ID);
      expect(flows.map((f) => f.id)).toContain(RECEIVE_DEFAULT_FLOW_ID);
      for (const f of flows) {
        const rd = await withHubScope(hub, { kind: "system" }, (tx) =>
          readinessOf(tx, tid, f.stages as unknown[], packTools),
        );
        expect([t, f.key, rd.ready, rd.reasons, rd.missing.groups]).toEqual([
          t,
          f.key,
          true,
          [],
          [],
        ]);
      }
    }
  }, 120_000);

  it("3 mẫu «Quy trình mua hàng» có trong Thư viện và templateReadiness ready cho công ty demo + evolu (đủ nhóm, có thành viên)", async () => {
    for (const t of ["evolu", "demo"]) {
      const tid = ids.get(t) as string;
      const defs = await sql`select d.key, d.stages from hub.process_defs d
        where d.tenant_id is null and d.key like 'mua-hang-%' and d.published_version = 1 order by d.key`;
      expect(defs.map((d) => d.key)).toEqual([
        "mua-hang-1-de-xuat-dat-hang",
        "mua-hang-2-hop-dong",
        "mua-hang-3-nhan-hang-thanh-toan",
      ]);
      for (const d of defs) {
        const rd = await withHubScope(hub, { kind: "system" }, (tx) =>
          readinessOf(tx, tid, d.stages as unknown[], packTools),
        );
        expect([t, d.key, rd.ready, rd.reasons, rd.missing.groups]).toEqual([
          t,
          d.key,
          true,
          [],
          [],
        ]);
      }
      const empty = await sql`select g.key from admin.groups g where g.tenant_id = ${tid}
        and g.key in ('nhan-vien-phong-ban', 'truong-bo-phan', 'mua-hang', 'truong-mua-hang', 'tai-chinh', 'phap-che',
          'ke-toan', 'ke-toan-truong', 'kho', 'thu-quy')
        and not exists (select 1 from admin.group_members m where m.group_id = g.id)`;
      expect(empty.map((x) => x.key)).toEqual([]);
    }
  }, 120_000);

  it("ops-watch: flow_flag 0 công ty lệch; hồ sơ công ty, cấu hình duyệt HĐ, danh mục feature đều ok", async () => {
    const r = await withHubScope(hub, { kind: "system" }, async (tx) => ({
      flag: (await tx.execute<{ n: number; sample: string[] }>(flowFlagQuery()))[0],
      profile: [
        ...(await tx.execute<{ rule: 1 | 2; n: number; sample: string[] }>(tenantProfileQuery())),
      ],
      approval: (
        await tx.execute<{ unrouted: string[]; broken: string[] }>(approvalConfigQuery())
      )[0],
      catalog: (
        await tx.execute<{ engine_feature: boolean; feature_app_missing: string[] }>(
          featureCatalogQuery(),
        )
      )[0],
    }));
    const flag = evaluateFlowFlag({ n: Number(r.flag?.n ?? 0), sample: r.flag?.sample ?? [] });
    expect([flag.status, flag.value]).toEqual(["ok", { count: 0 }]);
    expect(evaluateTenantProfile(r.profile.map((x) => ({ ...x, n: Number(x.n) }))).status).toBe(
      "ok",
    );
    const cov = evaluateFlowCoverage({
      checked: 0,
      gap_count: 0,
      gaps: [],
      unrouted: r.approval?.unrouted ?? [],
      broken: r.approval?.broken ?? [],
      engine_feature: r.catalog?.engine_feature ?? false,
      feature_app_missing: r.catalog?.feature_app_missing ?? [],
    });
    expect([cov.status, cov.message]).toEqual(["ok", expect.any(String)]);
  }, 60_000);

  it("chạy lần hai: 0 hàng đổi (kết quả toàn 0, dấu vân tay bảng không đổi)", async () => {
    const before = await fingerprint();
    const again = await seed();
    expect(sumOf({ ...again, tenants: 0 })).toBe(0); // `tenants` = số công ty thấy, không phải hàng đổi
    expect(await fingerprint()).toBe(before);
  }, 60_000);
});
