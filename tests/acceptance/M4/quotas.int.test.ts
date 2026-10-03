// ADM-FR-40 · M4-R02, R03, R10 · Q9 · GET/PUT /admin/tenants/:id/quotas (test-plan Q1–Q10; M4-AC02, M4-AC15).
// Xanh ở T3. PUT không chờ evaluator; ca no-op (Q10) chứng minh "không evaluate" bằng sentinel PUT globex có mail.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  alertRows,
  auditMark,
  audits,
  countOf,
  createM4Env,
  expectErr4,
  ID,
  ID4,
  insertUsage,
  type Listener,
  type M4Env,
  mailsTo,
  parse4,
  poll,
  putQuota,
  qi,
  quotaPath,
  resetNow,
  setQuota,
  TENANT_ID,
  tenantVer,
  track,
  vnMonth,
} from "./_ab";

let env: M4Env;
let lis: Listener;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
const KT = ID.feature.keToan;
const BC = ID.feature.baoCao;

beforeAll(async () => {
  env = await createM4Env();
  lis = await env.listen();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

const Q2_ITEMS = [
  qi(null, { runs: 1000 }),
  qi(KT, { usd: "300.00" }),
  qi(BC, { tokens: 5_000_000 }),
];
const quotaCount = () =>
  countOf(env, `select count(*)::int as n from admin.tenant_quotas where tenant_id = '${A}'`);
const updatedBy = async (t: string) => {
  const [r] = await env.owner`select u.username from admin.tenants t
    left join admin.users u on u.id = t.updated_by where t.id = ${t}`;
  return (r?.username ?? null) as string | null;
};

describe("ADM-FR-40 · GET quota", () => {
  it("ADM-FR-40 · M4-AC02 · Q1 · acme chưa đặt → 200, items[0] feature_id null, 3 giới hạn null, pct null, level none; month = tháng VN", async () => {
    const res = await env.as("GET", quotaPath(A));
    expect(res.status).toBe(200);
    const b = parse4("QuotaSetResponseSchema", res.json);
    expect(b.tenant_id).toBe(A);
    expect(b.month).toBe(vnMonth(new Date()));
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({
      feature_id: null,
      max_runs: null,
      max_tokens: null,
      max_usd: null,
      pct: null,
      level: "none",
    });
  });
});

describe("ADM-FR-40 · PUT quota", () => {
  it("ADM-FR-40 · M4-AC15 · Q2 · PUT 3 dòng → 200; thứ tự null, bao-cao, ke-toan; tenant version +1, updated_by admin", async () => {
    const v = await tenantVer(env, A);
    const res = await putQuota(env, A, Q2_ITEMS, v);
    expect(res.status).toBe(200);
    const b = parse4("QuotaSetResponseSchema", res.json);
    expect(b.items.map((i: { feature_key: string | null }) => i.feature_key)).toEqual([
      null,
      "bao-cao",
      "ke-toan",
    ]);
    expect(b.items[0].max_runs).toBe(1000);
    expect(b.items[1].max_tokens).toBe(5_000_000);
    expect(Number(b.items[2].max_usd)).toBe(300);
    expect(b.version).toBe(v + 1);
    expect(await tenantVer(env, A)).toBe(v + 1);
    expect(await updatedBy(A)).toBe("admin");
    expect(await quotaCount()).toBe(3);
  });

  it("ADM-FR-40 · M4-R03 · Q3 · 800 run (400 ke-toan) → dòng null runs 800 pct 80 warn; ke-toan billable 40, pct 13", async () => {
    await insertUsage(env.owner, 400, { tenant: A, feature: KT });
    await insertUsage(env.owner, 400, { tenant: A });
    expect((await putQuota(env, A, Q2_ITEMS)).status).toBe(200);
    const b = parse4("QuotaSetResponseSchema", (await env.as("GET", quotaPath(A))).json);
    const all = b.items[0];
    expect(all.used.runs).toBe(800);
    expect(all.pct).toBe(80);
    expect(all.level).toBe("warn");
    const kt = b.items.find((i: { feature_id: string | null }) => i.feature_id === KT);
    expect(Number(kt.used.billable_usd)).toBe(40);
    expect(kt.used.runs).toBe(400);
    expect(kt.pct).toBe(13);
    expect(kt.level).toBe("none");
    expect(b.has_usage_data).toBe(true);
  });

  it("ADM-FR-40 · M4-R02 · Q4 · dòng mọi giới hạn null bị bỏ; items [] xoá hết, GET còn dòng null không giới hạn", async () => {
    let res = await putQuota(env, A, [qi(null, { runs: 10 }), qi(KT, {})]);
    expect(res.status).toBe(200);
    expect(await quotaCount()).toBe(1);
    res = await putQuota(env, A, []);
    expect(res.status).toBe(200);
    expect(await quotaCount()).toBe(0);
    const b = parse4("QuotaSetResponseSchema", (await env.as("GET", quotaPath(A))).json);
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({
      feature_id: null,
      max_runs: null,
      pct: null,
      level: "none",
    });
  });

  it("ADM-FR-40 · M4-R02 · Q5 · trùng null / trùng feature / 101 dòng / max_runs 0 / max_usd '1.234' → 400 VALIDATION_ERROR, DB không đổi", async () => {
    await setQuota(env.owner, A, null, { runs: 50 });
    const v = await tenantVer(env, A);
    const many = Array.from({ length: 101 }, () => qi(null, { runs: 1 }));
    const bad = [
      [qi(null, { runs: 1 }), qi(null, { runs: 2 })],
      [qi(KT, { runs: 1 }), qi(KT, { tokens: 2 })],
      many,
      [qi(null, { runs: 0 })],
      [qi(null, { usd: "1.234" })],
    ];
    for (const items of bad) {
      expectErr4(await putQuota(env, A, items, v), "VALIDATION_ERROR");
    }
    expect(await tenantVer(env, A)).toBe(v);
    const rows = await env.owner`select max_runs from admin.tenant_quotas where tenant_id = ${A}`;
    expect(rows.map((r) => r.max_runs)).toEqual([50]);
  });

  it("ADM-FR-40 · Q6 · feature uuid không tồn tại → 400 INVALID_REFERENCE", async () => {
    expectErr4(await putQuota(env, A, [qi(ID4.unknown, { runs: 5 })]), "INVALID_REFERENCE");
    expect(await quotaCount()).toBe(0);
  });

  it("ADM-FR-40 · ADM-FR-55 · M4-AC15 · Q7 · PUT version cũ → 409 VERSION_CONFLICT, details.current = bộ đang lưu, có updated_at; DB không đổi", async () => {
    const v = await tenantVer(env, A);
    expect((await putQuota(env, A, [qi(null, { runs: 70 })], v)).status).toBe(200);
    const d = expectErr4(await putQuota(env, A, [qi(null, { runs: 90 })], v), "VERSION_CONFLICT");
    const cur = parse4("QuotaSetResponseSchema", d.current);
    expect(cur.version).toBe(v + 1);
    expect(cur.items[0].max_runs).toBe(70);
    expect(typeof d.updated_at).toBe("string");
    expect(await tenantVer(env, A)).toBe(v + 1);
  });

  it("ADM-BR-09 · AC-A09 · Q8 · binh GET globex 404, GET acme 200, PUT acme 403; an GET 403; admin GET tenant không tồn tại 404", async () => {
    const binh = env.by("acme", "binh");
    expectErr4(await binh("GET", quotaPath(G)), "NOT_FOUND");
    expect((await binh("GET", quotaPath(A))).status).toBe(200);
    expectErr4(
      await binh("PUT", quotaPath(A), { version: await tenantVer(env, A), items: [] }),
      "FORBIDDEN",
    );
    expectErr4(await env.by("acme", "an")("GET", quotaPath(A)), "FORBIDDEN");
    expectErr4(await env.as("GET", quotaPath(ID4.unknown)), "NOT_FOUND");
    expectErr4(await env.as("PUT", quotaPath(ID4.unknown), { version: 1, items: [] }), "NOT_FOUND");
  });

  it("ADM-FR-51 · M4-R10 · Q9 · PUT → đúng 1 audit update quota acme (entity_name acme, snapshot, entity_version v+1, before/after.items); 409 → 0 dòng", async () => {
    await setQuota(env.owner, A, null, { runs: 10 });
    const v = await tenantVer(env, A);
    const mark = await auditMark(env.owner);
    expect(
      (await putQuota(env, A, [qi(null, { runs: 20 }), qi(KT, { usd: "5.00" })], v)).status,
    ).toBe(200);
    const rows = await audits(env, mark);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({
      action: "update",
      entity: "quota",
      tenant_id: A,
      entity_name: "acme",
      snapshot: true,
      entity_version: v + 1,
      actor_username: "admin",
    });
    const before = (
      (r?.before ?? { items: [] }) as {
        items: { feature_id: string | null; max_runs: number | null }[];
      }
    ).items;
    const after = (
      (r?.after ?? { items: [] }) as {
        items: { feature_id: string | null; feature_key: string | null }[];
      }
    ).items;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ feature_id: null, max_runs: 10 });
    expect(after.map((i) => i.feature_key)).toEqual([null, "ke-toan"]);
    const mark2 = await auditMark(env.owner);
    expectErr4(await putQuota(env, A, [qi(null, { runs: 30 })], v), "VERSION_CONFLICT");
    expect(await audits(env, mark2)).toHaveLength(0);
  });

  it("ADM-FR-40 · M4-R10 · Q10 · PUT cùng bộ đang lưu (no-op) → 200 bộ hiện tại; version/updated_by không đổi; 0 audit, 0 NOTIFY, không evaluate (0 alert, 0 mail)", async () => {
    await insertUsage(env.owner, 900, { tenant: A });
    await setQuota(env.owner, A, null, { runs: 1000 });
    await setQuota(env.owner, A, KT, { usd: "300" });
    const v = await tenantVer(env, A);
    const by0 = await updatedBy(A);
    const mark = await auditMark(env.owner);
    const t = await track(env, lis, () =>
      putQuota(env, A, [qi(KT, { usd: "300.00" }), qi(null, { runs: 1000 })], v),
    );
    expect(t.res.status).toBe(200);
    const b = parse4("QuotaSetResponseSchema", t.res.json);
    expect(b.version).toBe(v);
    expect(b.items).toHaveLength(2);
    expect(t.v1).toBe(t.v0);
    expect(t.msgs).toHaveLength(0);
    expect(await tenantVer(env, A)).toBe(v);
    expect(await updatedBy(A)).toBe(by0);
    expect(await audits(env, mark)).toHaveLength(0);
    // sentinel: PUT thật cho globex (90%) → evaluator gửi mail cho hoa; tới lúc đó acme vẫn không có alert/mail
    await insertUsage(env.owner, 90, { tenant: G });
    expect((await putQuota(env, G, [qi(null, { runs: 100 })])).status).toBe(200);
    await poll(() => mailsTo(env, "hoa@globex.test").length, 1);
    expect(await alertRows(env, A)).toHaveLength(0);
    expect(mailsTo(env, "binh@acme.test")).toHaveLength(0);
  });
});
