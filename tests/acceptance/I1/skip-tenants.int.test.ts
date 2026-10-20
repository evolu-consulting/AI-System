// I1 · review A-4: tenant đã có marker nguồn nhưng N5 bỏ qua (đã tắt / đã thu hồi gói `contracts`) ⇒ importer KHÔNG ghi gì
// vào đó (HĐ, tri thức, vùng chờ…), báo `skipped_tenants` + `tenant.*` — chạy lại không hoàn tác việc admin thu hồi (L2).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ImportReport } from "../../../apps/admin-api/src/modules/mgmt-import/application/import.usecase";
import {
  type RunConfig,
  runMgmtImport,
} from "../../../apps/admin-api/src/modules/mgmt-import/mgmt-import.run";
import { fakeReader, fixtureSnapshot, ORG_A, ORG_B, SOURCE } from "./_support/fixture";
import { type CtxI1, counts, startI1 } from "./_support/i1";

const TA = "0a1c0000-0000-4000-8000-00000000000a";
const TB = "0b1c0000-0000-4000-8000-00000000000b";
let ctx: CtxI1;

const cfg = (apply: boolean): RunConfig => ({
  source: SOURCE,
  actorId: ctx.padmin,
  apply,
  batch: 50,
  knowledgeOrg: ORG_A,
  withGraph: true,
  diffSample: 5,
  opensearch: { url: "http://unused" },
  neo4j: null,
  filesDir: ctx.filesDir,
  sinkDir: ctx.sinkDir,
  statePath: null,
});
const run = (apply: boolean): Promise<ImportReport> =>
  runMgmtImport(ctx.db, ctx.hub, cfg(apply), fakeReader(fixtureSnapshot()));

beforeAll(async () => {
  ctx = await startI1();
  const mark = (org: string) => ctx.sql.json({ mgmt_source: SOURCE, mgmt_org_id: org });
  // A: đang hoạt động nhưng admin đã thu hồi gói contracts · B: tenant đã tắt
  await ctx.sql`insert into admin.tenants (id, key, name, active, settings) values
    (${TA}, 'i1c-a', 'A thu hồi', true, ${mark(ORG_A)}), (${TB}, 'i1c-b', 'B đã tắt', false, ${mark(ORG_B)})`;
  await ctx.sql`insert into admin.feature_entitlements (feature_id, tenant_id, revoked_at)
    select f.id, ${TA}, now() from admin.features f where f.key = 'contracts-read'`;
});
afterAll(async () => {
  await ctx?.stop();
});

describe("I1 review A-4 · tenant N5 bỏ qua", () => {
  test("dry-run + apply: tenant tắt / đã thu hồi gói nhận 0 hàng dữ liệu, được báo đúng lý do", async () => {
    const dry = await run(false);
    expect(Object.keys(dry.tables)).toEqual([]);
    const before = await counts(ctx);
    const r = await run(true);
    const after = await counts(ctx);
    for (const t of Object.keys(after).filter(
      (k) => k.startsWith("contracts.") || k.startsWith("knowledge."),
    ))
      expect({ t, n: after[t] }).toEqual({ t, n: before[t] });
    expect(r.skipped_tenants.map((s) => [s.tenantId, s.reason]).sort()).toEqual([
      [TA, "PACK_REVOKED"],
      [TB, "TENANT_INACTIVE"],
    ]);
    expect(r.issues_by_code).toMatchObject({
      "tenant.PACK_REVOKED": 1,
      "tenant.TENANT_INACTIVE": 1,
    });
    expect(r.no_tenant.contracts).toBeGreaterThanOrEqual(6);
    // gói vẫn thu hồi, tenant vẫn tắt (không bật lại)
    const [s] = await ctx.sql<{ revoked: boolean; active: boolean }[]>`select
      (select revoked_at is not null from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
        where e.tenant_id = ${TA} and f.key = 'contracts-read') as revoked,
      (select active from admin.tenants where id = ${TB}) as active`;
    expect(s).toEqual({ revoked: true, active: false });
  });
});
