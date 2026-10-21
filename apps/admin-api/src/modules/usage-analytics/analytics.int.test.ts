// ADM-FR-42 · usage-analytics · int đường chính mỗi endpoint mới (analytics, records + CSV, drill-down run — gọi đúng hàm
// service mà route gọi sau `parseQuery`) trên DB đầy đủ Admin + Hub (bảng tổng hợp `hub.usage_daily` do trigger hub 0049
// giữ: INSERT + UPDATE gắn nhãn), role `admin_api` + scope RLS thật; và chặn đọc chéo tenant: tenant_admin globex không đọc
// được usage acme (tham số tenant_id / run của tenant khác ⇒ NOT_FOUND; không tham số ⇒ chỉ tenant mình, không cost_usd).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type DbScope } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import type { Actor } from "../../lib/auth-middleware";
import { type AnalyticsCall, getAnalytics } from "./analytics.service";
import { getRecords, getRecordsCsv, getRun } from "./records.service";

const id = (n: number) => `a4900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1);
const G = id(2);
const BINH = id(11);
const CHI = id(12);
const HOA = id(13);
const RUN = id(21);
const AGENT = id(31);

let owner: Sql;
let db: Db;
const vnDay = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const range = () => ({ from: vnDay(), to: vnDay() });

const call = (role: Actor["role"], tenantId: string, scope: DbScope): AnalyticsCall => ({
  ctx: { db, now: () => new Date() },
  actor: {
    userId: role === "platform_admin" ? BINH : HOA,
    tenantId,
    tenantKey: "x",
    role,
    sid: null,
  },
  scope,
});
const platform = () => call("platform_admin", A, { kind: "platform" });
const hoa = () => call("tenant_admin", G, { kind: "tenant", tenantId: G });

async function seed(o: Sql): Promise<void> {
  await o`insert into admin.tenants (id, key, name) values (${A}, 'acme', 'Acme'), (${G}, 'globex', 'Globex')`;
  await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email)
    values (${BINH}, ${A}, 'binh', 'x', 'Binh', 'tenant_admin', 'binh@x.test'),
      (${CHI}, ${A}, 'chi', 'x', 'Chi', 'member', 'chi@x.test'),
      (${HOA}, ${G}, 'hoa', 'x', 'Hoa', 'tenant_admin', 'hoa@x.test')`;
  // acme: 2 dòng run chat (runtime, gói ⇒ cost 0) + AI client contracts.extract (api, có giá) + price_search lỗi.
  await o`insert into hub.usage_logs (tenant_id, run_id, user_id, agent_id, provider_key, model, billing, input_tokens,
      output_tokens, cache_read_tokens, cost_usd, latency_ms, at)
    values (${A}, ${RUN}, ${BINH}, ${AGENT}, 'claude-sub', 'claude-sonnet-5-5', 'subscription', 1000, 200, 50, 0, 1200,
      now() - interval '2 seconds'),
      (${A}, ${RUN}, ${BINH}, ${AGENT}, 'claude-sub', 'claude-sonnet-5-5', 'subscription', 500, 100, 0, 0, 800,
      now() - interval '1 second')`;
  await o`insert into hub.usage_logs (tenant_id, user_id, feature, provider_key, model, billing, input_tokens,
      output_tokens, cost_usd, latency_ms, outcome)
    values (${A}, ${CHI}, 'contracts.extract', 'anthropic', 'claude-opus-5-5', 'api', 3000, 400, 0.02, 5000, 'ok'),
      (${A}, ${CHI}, 'contracts.price_search', 'anthropic', 'claude-haiku-5-5', 'api', 100, 0, 0.0001, 300, 'error')`;
  await o`insert into hub.usage_logs (tenant_id, feature, provider_key, model, billing, input_tokens, output_tokens,
      cost_usd, outcome)
    values (${G}, 'knowledge.rerank', 'anthropic', 'claude-haiku-5-5', 'api', 7, 3, 0.000001, 'ok')`;
  // Hub gắn nhãn run khi job xong (UPDATE ⇒ trigger dời dòng tổng hợp sang app/feature/outcome mới).
  await o`select hub.tag_run_usage(${A}, ${RUN}, false, true)`;
}

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  db = createDb(withCreds(urls().owner, "admin_api", "admin_api_dev_pw"), { max: 2 });
  await seed(owner);
});
afterAll(async () => {
  await db.close();
  await owner.end({ timeout: 1 });
});

describe("ADM-FR-42 · usage-analytics · analytics", () => {
  it("GET /admin/usage/analytics (platform, acme): KPI, app → agent → model, tier, chuỗi thời gian, cost", async () => {
    const b = await getAnalytics(platform(), { tenant_id: A, ...range(), grain: "day" });
    expect(b.kpi).toMatchObject({
      input_tokens: 4600,
      output_tokens: 700,
      tokens: 5300,
      calls: 4,
      runs: 1,
      errors: 1,
      cost_usd: "0.0201",
      avg_latency_ms: 1825,
    });
    expect(Object.fromEntries(b.by_app.map((x) => [x.key, x.tokens]))).toEqual({
      chat: 1800,
      contracts: 3500,
    });
    expect(b.by_feature.map((x) => x.key)).toEqual([
      "contracts.extract",
      "chat",
      "contracts.price_search",
    ]);
    expect(b.by_tier.map((x) => x.key)).toEqual(["opus", "sonnet", "haiku"]);
    expect(b.by_user.map((x) => x.label)).toEqual(["chi", "binh"]);
    expect(b.tree[0]).toMatchObject({
      app: "contracts",
      feature: "contracts.extract",
      tier: "opus",
    });
    expect(b.tree.find((t) => t.agent_id === AGENT)).toMatchObject({ app: "chat", tokens: 1800 });
    expect(b.series.map((s) => s.bucket)).toEqual([vnDay(), vnDay()]);
    expect(b.by_tenant).toEqual([]);
    const all = await getAnalytics(platform(), range());
    expect(all.by_tenant.map((x) => [x.label, x.tokens])).toEqual([
      ["acme", 5300],
      ["globex", 10],
    ]);
  });
});

describe("ADM-FR-42 · usage-analytics · records + run", () => {
  it("GET /admin/usage/records (+ .csv) trang keyset; GET /admin/usage/runs/:id gom dòng của run", async () => {
    const p1 = await getRecords(platform(), { tenant_id: A, ...range(), limit: 3 });
    expect(p1.items).toHaveLength(3);
    expect(p1.items[0]).toMatchObject({ tenant_key: "acme" });
    const cursor = p1.next_cursor ?? "";
    const p2 = await getRecords(platform(), { tenant_id: A, ...range(), limit: 3, cursor });
    expect(p2.items).toHaveLength(1);
    expect(p2.next_cursor).toBeNull();
    const csv = await getRecordsCsv(platform(), { tenant_id: A, ...range() });
    expect(csv.body.split("\r\n")[0]).toContain("cost_usd");
    expect(csv.body.split("\r\n")).toHaveLength(6); // tiêu đề + 4 dòng + dòng rỗng sau CRLF cuối
    const run = await getRun(platform(), RUN);
    expect(run.items.map((x) => [x.app, x.feature, x.outcome])).toEqual([
      ["chat", "chat", "ok"],
      ["chat", "chat", "ok"],
    ]);
    expect(run.total).toMatchObject({ tokens: 1800, calls: 2 });
  });
});

describe("ADM-FR-42 · usage-analytics · cách ly tenant", () => {
  it("tenant_admin globex không đọc được usage acme (analytics, records, run); bản tenant không cost_usd", async () => {
    const nf = { code: "NOT_FOUND" };
    await expect(getAnalytics(hoa(), { tenant_id: A, ...range() })).rejects.toMatchObject(nf);
    await expect(getRecords(hoa(), { tenant_id: A, ...range() })).rejects.toMatchObject(nf);
    await expect(getRun(hoa(), RUN)).rejects.toMatchObject(nf);
    const own = await getAnalytics(hoa(), range());
    expect([own.tenant_id, own.kpi.tokens]).toEqual([G, 10]);
    expect(JSON.stringify(own)).not.toContain("cost_usd");
    const recs = await getRecords(hoa(), range());
    expect(recs.items.map((x) => x.tenant_id)).toEqual([G]);
    // Lớp RLS độc lập với role: actor "platform" nhưng scope DB = tenant globex ⇒ acme vẫn NOT_FOUND (RLS admin.tenants).
    const forged = call("platform_admin", G, { kind: "tenant", tenantId: G });
    await expect(getAnalytics(forged, { tenant_id: A, ...range() })).rejects.toMatchObject(nf);
  });
});
