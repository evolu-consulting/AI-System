// I1 · importer mgmt-app trên DB thật (role admin_api + hub_api, RLS bật), nguồn GIẢ trong bộ nhớ (fixture.ts phủ mọi mapper):
// dry-run không ghi · apply ghi đủ bảng + tiền khớp tuyệt đối + file sha256 + luật thấy từng user khớp mgmt-app · chạy lại không
// nhân đôi · tách tenant (org B không thấy hàng org A).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import type { ImportReport } from "../../../apps/admin-api/src/modules/mgmt-import/application/import.usecase";
import { targetId } from "../../../apps/admin-api/src/modules/mgmt-import/domain/ids.rules";
import {
  type RunConfig,
  runMgmtImport,
} from "../../../apps/admin-api/src/modules/mgmt-import/mgmt-import.run";
import { EXPECT_A, fakeReader, fixtureSnapshot, ORG_A, ORG_B, SOURCE } from "./_support/fixture";
import { type CtxI1, counts, startI1 } from "./_support/i1";

let ctx: CtxI1;
let first: ImportReport;
const cfg = (apply: boolean): RunConfig => ({
  source: SOURCE,
  actorId: ctx.padmin,
  apply,
  batch: 2, // lô nhỏ ⇒ nhiều lô mỗi bảng (đường lô thật)
  knowledgeOrg: ORG_A,
  withGraph: true,
  diffSample: 50,
  opensearch: { url: "http://unused" },
  neo4j: null,
  filesDir: ctx.filesDir,
  sinkDir: ctx.sinkDir,
  statePath: null,
});
const run = (apply: boolean) =>
  runMgmtImport(ctx.db, ctx.hub, cfg(apply), fakeReader(fixtureSnapshot()));
const tenantOf = async (org: string) =>
  (
    await ctx.sql<
      { id: string }[]
    >`select id from admin.tenants where settings->>'mgmt_org_id' = ${org}`
  )[0]?.id as string;

beforeAll(async () => {
  ctx = await startI1();
});
afterAll(async () => {
  await ctx?.stop();
});

describe("I1 mgmt-import", () => {
  test("dry-run: không ghi gì, vẫn lập kế hoạch đủ bảng", async () => {
    const before = await counts(ctx);
    const r = await run(false);
    expect(await counts(ctx)).toEqual(before);
    expect(r.dry_run).toBe(true);
    expect(r.reconcile).toBeNull();
    expect(r.tables["contracts.contracts"]?.planned).toBe(6);
    expect(r.tables["knowledge.entities"]?.planned).toBe(2);
  });

  test("apply: mọi bảng đích có hàng, tiền khớp tuyệt đối nguồn = kế hoạch = đích", async () => {
    first = await run(true);
    const rec = first.reconcile;
    expect(rec?.money_ok).toBe(true);
    const a = rec?.money[ORG_A] ?? {};
    for (const [k, v] of Object.entries(EXPECT_A))
      expect({ k, target: a[k as keyof typeof a]?.target }).toEqual({ k, target: v.toString() });
    expect(rec?.money[ORG_B]?.["contracts.total_value"]?.target).toBe("100");
    const c = await counts(ctx);
    expect(c).toMatchObject({
      "contracts.contracts": 6,
      "contracts.contract_items": 4,
      "contracts.contract_categories": 2,
      "contracts.contract_events": 6,
      "contracts.contract_reminders": 1,
      "contracts.files": 1,
      "contracts.cks_customers": 2,
      "contracts.cks_lots": 1,
      "contracts.cks_certificates": 3,
      "contracts.cks_renewals": 1,
      "contracts.cks_followups": 1,
      "contracts.cks_signed_docs": 2,
      "contracts.obligations": 2,
      "contracts.partner_events": 4,
      "contracts.partner_event_voids": 1,
      "contracts.visibility_settings": 2,
      "knowledge.documents": 2,
      "knowledge.chunks": 3,
      "knowledge.entities": 2,
      "knowledge.chunk_entities": 3,
      "knowledge.entity_rels": 1,
      "knowledge.chunk_links": 1,
      "knowledge.document_links": 1,
      "admin.user_managers": 2,
    });
    // cks market: 1 dùng chung × 2 tenant + 1 của A
    const [m] = await ctx.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.cks_market_prices`;
    expect(m?.n).toBe(3);
    // nhân viên nội bộ không thuộc org ⇒ N5 NO_ORG (không chuyển — đúng); còn lại là trùng ở nguồn có chủ đích
    expect(first.issues_by_code).toEqual({ SIGNED_DUP: 1, DOC_DUP_HASH: 1, "identity.NO_ORG": 1 });
    expect(first.no_tenant).toMatchObject({ contracts: 1, chats: 1 });
  });

  test("trường + hạng mục + loại + phụ lục + hash scrypt cũ chuyển đúng", async () => {
    const A = await tenantOf(ORG_A);
    const [c1] = await ctx.sql<
      Record<string, unknown>[]
    >`select number, seller, value, end_date::text, type, direction,
        fields->'total_value'->>'quote' as q, category_ids from contracts.contracts where id = ${targetId(SOURCE, "contract", "c1")}`;
    expect(c1).toMatchObject({
      number: "PORK-2026",
      seller: "Bình An",
      value: "588000000",
      end_date: "2026-12-31",
      type: "purchase",
      direction: "purchase",
      q: "«588000000»",
    });
    expect((c1?.category_ids as string[] | undefined)?.length).toBe(2);
    const [c5] = await ctx.sql<
      { kind: string; parent_id: string; owner: string }[]
    >`select kind, parent_id, owner_user_id as owner
      from contracts.contracts where id = ${targetId(SOURCE, "contract", "c5")}`;
    const [m1] = await ctx.sql<
      { id: string }[]
    >`select id from admin.users where tenant_id = ${A} and email = 'm1@annam.test'`;
    expect(c5).toEqual({
      kind: "appendix",
      parent_id: targetId(SOURCE, "contract", "c1"),
      owner: m1?.id as string,
    });
    const [h] = await ctx.sql<
      { h: string }[]
    >`select password_hash as h from admin.users where email = 'e1@annam.test'`;
    expect(h?.h.startsWith("$scrypt-legacy$")).toBe(true);
    const [v] = await ctx.sql<
      { mode: string }[]
    >`select mode from contracts.visibility_settings where tenant_id = ${A}`;
    expect(v?.mode).toBe("org");
  });

  test("đối soát: file sha256 khớp, văn bản ký khớp, mẫu so trường không lệch, mỗi user thấy đúng tập HĐ của mgmt-app", () => {
    const rec = first.reconcile;
    expect(rec?.files).toEqual({ jobs: 1, found: 1, stored: 1, checksum_ok: 1 });
    expect(rec?.signed_sha.ok).toBe(true);
    expect(rec?.diffs).toEqual([]);
    expect(rec?.diffs_checked).toBeGreaterThan(5);
    // A: owner + m1 + e1 + v1 (inv chưa active ⇒ bỏ); B: owner
    expect(rec?.visibility).toEqual({ users: 5, match: 5, inactive_skipped: 1, mismatches: [] });
  });

  test("chạy lại: không chèn thêm hàng nào (idempotent), đối soát vẫn khớp", async () => {
    const before = await counts(ctx);
    const again = await run(true);
    expect(await counts(ctx)).toEqual(before);
    const inserted = Object.values(again.tables).reduce((s, t) => s + (t?.inserted ?? 0), 0);
    expect(inserted).toBe(0);
    expect(again.reconcile?.money_ok).toBe(true);
    expect(again.reconcile?.visibility.mismatches).toEqual([]);
  });

  test("tách tenant: dưới RLS của tenant B không thấy hàng của A", async () => {
    const B = await tenantOf(ORG_B);
    const n = await withPackScope(
      ctx.hub,
      { packKey: "contracts", tenantId: B, userId: null },
      async (tx) => {
        const rows = (await tx.execute(
          "select count(*)::int as n from contracts.contracts",
        )) as unknown as { n: number }[];
        return rows[0]?.n;
      },
    );
    expect(n).toBe(1);
  });
});
