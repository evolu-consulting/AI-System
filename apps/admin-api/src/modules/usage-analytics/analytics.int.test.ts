// ADM-FR-42 · usage-analytics · int đường chính mỗi endpoint mới (analytics, records + CSV, drill-down run) trên bảng tổng
// hợp do trigger hub 0049 giữ (INSERT + UPDATE gắn nhãn), và chặn đọc chéo tenant: tenant_admin globex không đọc được usage
// của acme (tham số tenant_id / run_id của tenant khác ⇒ 404; không tham số ⇒ chỉ số của tenant mình, không cost_usd).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  createM4Env,
  type M4Env,
  resetNow,
  TENANT_ID,
  USER_ID,
  vnDate,
} from "../../../../../tests/acceptance/M4/_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
const RUN = "a4900000-0000-4000-8000-000000000001";
const AGENT = "a4900000-0000-4000-8000-0000000000a1";
const day = () => vnDate(new Date());
const range = () => `from=${day()}&to=${day()}`;

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
  const o = env.owner;
  // acme: 2 dòng run chat (runtime, gói ⇒ cost 0) + 1 lời gọi AI client contracts.extract (api, có giá) + 1 lỗi.
  await o`insert into hub.usage_logs (tenant_id, run_id, user_id, agent_id, provider_key, model, billing, input_tokens,
      output_tokens, cache_read_tokens, cost_usd, latency_ms, at)
    values (${A}, ${RUN}, ${USER_ID.binh}, ${AGENT}, 'claude-sub', 'claude-sonnet-5-5', 'subscription', 1000, 200, 50, 0,
      1200, now() - interval '2 seconds'),
      (${A}, ${RUN}, ${USER_ID.binh}, ${AGENT}, 'claude-sub', 'claude-sonnet-5-5', 'subscription', 500, 100, 0, 0, 800,
      now() - interval '1 second')`;
  await o`insert into hub.usage_logs (tenant_id, user_id, feature, provider_key, model, billing, input_tokens,
      output_tokens, cost_usd, latency_ms, outcome)
    values (${A}, ${USER_ID.chi}, 'contracts.extract', 'anthropic', 'claude-opus-5-5', 'api', 3000, 400, 0.02, 5000, 'ok'),
      (${A}, ${USER_ID.chi}, 'contracts.price_search', 'anthropic', 'claude-haiku-5-5', 'api', 100, 0, 0.0001, 300,
      'error')`;
  // globex: một dòng (tenant khác)
  await o`insert into hub.usage_logs (tenant_id, feature, provider_key, model, billing, input_tokens, output_tokens,
      cost_usd, outcome)
    values (${G}, 'knowledge.rerank', 'anthropic', 'claude-haiku-5-5', 'api', 7, 3, 0.000001, 'ok')`;
  // Hub gắn nhãn run khi xong (UPDATE ⇒ trigger chuyển dòng tổng hợp sang app/feature mới).
  await o`select hub.tag_run_usage(${A}, ${RUN}, false, true)`;
});

describe("ADM-FR-42 · usage-analytics · analytics", () => {
  it("GET /admin/usage/analytics (platform, acme): KPI, app → agent → model, tier, chuỗi thời gian, cost", async () => {
    const r = await env.as("GET", `/admin/usage/analytics?tenant_id=${A}&${range()}&grain=day`);
    expect(r.status).toBe(200);
    const b = r.json;
    expect(b.kpi).toMatchObject({
      input_tokens: 4600,
      output_tokens: 700,
      tokens: 5300,
      calls: 4,
      runs: 1,
      errors: 1,
    });
    expect(b.kpi.cost_usd).toBe("0.0201");
    expect(b.kpi.avg_latency_ms).toBe(1825);
    const apps = Object.fromEntries(
      b.by_app.map((x: { key: string; tokens: number }) => [x.key, x.tokens]),
    );
    expect(apps).toEqual({ chat: 1800, contracts: 3500 });
    expect(b.by_feature.map((x: { key: string }) => x.key)).toEqual([
      "contracts.extract",
      "chat",
      "contracts.price_search",
    ]);
    expect(b.by_tier.map((x: { key: string }) => x.key)).toEqual(["opus", "sonnet", "haiku"]);
    expect(b.tree[0]).toMatchObject({
      app: "contracts",
      feature: "contracts.extract",
      tier: "opus",
    });
    expect(b.tree.find((t: { agent_id: string | null }) => t.agent_id === AGENT)).toMatchObject({
      app: "chat",
      model: "claude-sonnet-5-5",
      tokens: 1800,
    });
    expect(b.series.map((s: { bucket: string }) => s.bucket)).toEqual([day(), day()]);
    expect(b.by_tenant).toEqual([]);
  });
});

describe("ADM-FR-42 · usage-analytics · records + run", () => {
  it("GET /admin/usage/records (+ .csv) trang keyset; GET /admin/usage/runs/:id gom dòng của run", async () => {
    const p1 = await env.as("GET", `/admin/usage/records?tenant_id=${A}&${range()}&limit=3`);
    expect(p1.status).toBe(200);
    expect(p1.json.items).toHaveLength(3);
    expect(p1.json.items[0]).toMatchObject({ tenant_key: "acme", app: expect.any(String) });
    const p2 = await env.as(
      "GET",
      `/admin/usage/records?tenant_id=${A}&${range()}&limit=3&cursor=${p1.json.next_cursor}`,
    );
    expect(p2.json.items).toHaveLength(1);
    expect(p2.json.next_cursor).toBeNull();
    const csv = await env.as("GET", `/admin/usage/records.csv?tenant_id=${A}&${range()}`);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n")[0]).toContain("cost_usd");
    const run = await env.as("GET", `/admin/usage/runs/${RUN}`);
    expect(run.status).toBe(200);
    expect(run.json.items.map((x: { app: string; outcome: string }) => [x.app, x.outcome])).toEqual(
      [
        ["chat", "ok"],
        ["chat", "ok"],
      ],
    );
    expect(run.json.total).toMatchObject({ tokens: 1800, calls: 2 });
  });
});

describe("ADM-FR-42 · usage-analytics · cách ly tenant", () => {
  it("chặn chéo tenant: tenant_admin globex không đọc được usage acme (analytics, records, run); bản tenant không cost", async () => {
    const hoa = env.by("globex", "hoa");
    expect((await hoa("GET", `/admin/usage/analytics?tenant_id=${A}&${range()}`)).status).toBe(404);
    expect((await hoa("GET", `/admin/usage/records?tenant_id=${A}&${range()}`)).status).toBe(404);
    expect((await hoa("GET", `/admin/usage/runs/${RUN}`)).status).toBe(404);
    const own = await hoa("GET", `/admin/usage/analytics?${range()}`);
    expect(own.status).toBe(200);
    expect(own.json.tenant_id).toBe(G);
    expect(own.json.kpi.tokens).toBe(10);
    expect(JSON.stringify(own.json)).not.toContain("cost_usd");
    const recs = await hoa("GET", `/admin/usage/records?${range()}`);
    expect(recs.json.items.map((x: { tenant_id: string }) => x.tenant_id)).toEqual([G]);
  });
});
