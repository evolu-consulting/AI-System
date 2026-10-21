// price-scout qua hub-api THáº¬T (AI giáº£ táº¥t Ä‘á»‹nh, seam `packs.contractsAi.model`): cáº¥u hÃ¬nh dÃ² giÃ¡ SP + máº·c Ä‘á»‹nh nhÃ³m (quyá»n, RLS chÃ©o
// tenant), lÆ°á»£t dÃ² báº¥m tay Ä‘i qua agent Hub `price-scout` (lá»‡nh há»‡ thá»‘ng cá»§a agent, usage feature/agent/app/trigger/SP), tráº§n thÃ¡ng,
// vÃ²ng dÃ² theo lá»‹ch chá»‰ nháº­n SP tá»›i háº¡n + báº­t, lÆ°u giÃ¡ + cáº£nh bÃ¡o "GiÃ¡ thá»‹ trÆ°á»ng thay Ä‘á»•i" vÃ o Cáº§n xá»­ lÃ½.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inPack } from "@ai/test-kit/db";
import { createAgentCaller } from "../../../apps/hub-api/src/lib/ai-client/agent-call";
import { createHubAiClient } from "../../../apps/hub-api/src/lib/ai-client/ai-client.env";
import { agentSpecOf } from "../../../apps/hub-api/src/modules/agents/agent-spec.service";
import { createPriceScoutScheduler } from "../../../apps/hub-api/src/modules/packs/contracts/price-scout.mount";
import { BASE, type CtxJ2, type Json, P, seedProduct, startJ2, T } from "../V2-J2/_support/v2j2";

let c: CtxJ2;
let pid: string;
let agentId: string;
type Person = (typeof P)[keyof typeof P];
const call = (p: Person, method: string, path: string, body?: unknown) =>
  c.hubCall(p, method, `${BASE}${path}`, body);
const REPLY = JSON.stringify({
  items: [
    { supplier_name: "FPT IS", kind: "new", price: 80_000, url: "https://fpt.vn/token" },
    { supplier_name: "Ráº» QuÃ¡", kind: "new", price: 70_000, url: "https://shop.bad.vn/x" },
    { supplier_name: "Viettel", kind: "new", price: 130_000, url: "https://viettel.vn/t" },
  ],
});

beforeAll(async () => {
  c = await startJ2();
  await c.sql`truncate contracts.products cascade`;
  await c.sql`truncate contracts.price_scout_usage, contracts.price_scout_quota, contracts.price_scout_defaults`;
  await c.sql`insert into hub.model_profiles (key, steps)
    values ('fake-1', ${JSON.stringify([{ provider_key: "fake-cli", model: null, on: [] }])}::text::jsonb)
    on conflict (key) do nothing`;
  const [a] = await c.sql<
    { id: string }[]
  >`insert into hub.agents (key, name, description, runtime, profile_id, system_prompt)
    select 'price-scout', ${JSON.stringify({ vi: "DÃ² giÃ¡", en: "Price scout" })}::text::jsonb,
      'Agent dÃ² giÃ¡ thá»‹ trÆ°á»ng cho test tÃ­ch há»£p', 'agentic-cli', id, 'SYS-SCOUT' from hub.model_profiles where key = 'fake-1'
    on conflict (key) do update set system_prompt = 'SYS-SCOUT', enabled = true, runtime = 'agentic-cli', model = null
    returning id`;
  agentId = a?.id as string;
  pid = await seedProduct(c, { tenant: T.acme, name: "USB Token kÃ½ sá»‘", avgCost: 100_000 });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe("price-scout", () => {
  it("cáº¥u hÃ¬nh SP: ghi Ä‘Ã¨ + káº¿ thá»«a nhÃ³m; quyá»n; tenant khÃ¡c khÃ´ng tháº¥y (API + RLS)", async () => {
    const put = await call(P.hoa, "PUT", `/products/${pid}/price-scout`, {
      keywords: ["token kÃ½ sá»‘"],
      exclude_sites: ["bad.vn"],
      region: "HÃ  Ná»™i",
    });
    expect(put.status).toBe(200);
    expect(put.json).toMatchObject({
      group: "goods",
      override: { keywords: ["token kÃ½ sá»‘"], region: "HÃ  Ná»™i" },
      effective: { enabled: false, schedule: "off", vat: "excl", keywords: ["token kÃ½ sá»‘"] },
      next_at: null,
      usage: { searches: 0, searches_limit: 300 },
    });
    expect((await call(P.tam, "PUT", `/products/${pid}/price-scout`, {})).status).toBe(403);
    expect(
      (await call(P.hoa, "PUT", `/products/${pid}/price-scout`, { mst: "0100684378" })).status,
    ).toBe(400);
    expect(
      (await call(P.hoa, "PUT", "/price-scout/defaults", { group: "goods", config: {} })).status,
    ).toBe(403);
    for (const m of ["GET", "PUT"] as const)
      expect(
        (await call(P.an, m, `/products/${pid}/price-scout`, m === "PUT" ? {} : undefined)).status,
      ).toBe(404);
    const seen = await inPack(
      "contracts",
      T.beta,
      (tx) => tx<{ n: number }[]>`select count(*)::int as n from contracts.price_scout_configs`,
    );
    const mine = await inPack(
      "contracts",
      T.acme,
      (tx) => tx<{ n: number }[]>`select count(*)::int as n from contracts.price_scout_configs`,
    );
    expect([seen[0]?.n, mine[0]?.n]).toEqual([0, 1]);
  });

  it("dÃ² báº¥m tay qua agent Hub: lá»‡nh há»‡ thá»‘ng cá»§a agent, lá»i nháº¯c = tÃªn SP + cáº¥u hÃ¬nh; usage feature/agent/trigger/SP", async () => {
    c.ai.next = { text: REPLY };
    c.ai.calls.length = 0;
    const r = await call(P.hoa, "POST", `/products/${pid}/suppliers/search`, {});
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: Json) => i.supplier_name)).toEqual(["FPT IS", "Viettel"]); // bad.vn bá»‹ loáº¡i
    expect(c.ai.calls[0]).toMatchObject({ system: "SYS-SCOUT", model: "sonnet", webSearch: true });
    const prompt = JSON.parse(c.ai.calls[0]?.prompt as string);
    expect(prompt).toMatchObject({
      product: "USB Token kÃ½ sá»‘",
      keywords: ["token kÃ½ sá»‘"],
      region: "HÃ  Ná»™i",
    });
    expect(c.ai.calls[0]?.prompt).not.toContain("acme");
    const [u] = await c.sql<
      Json[]
    >`select agent_id, app, trigger_kind, subject_id, user_id, outcome from hub.usage_logs
      where feature = 'contracts.price_scout' and tenant_id = ${T.acme} order by at desc limit 1`;
    expect(u).toEqual({
      agent_id: agentId,
      app: "contracts",
      trigger_kind: "manual",
      subject_id: pid,
      user_id: P.hoa.id,
      outcome: "ok",
    });
    // MÃ n Usage analytics Ä‘á»c báº£ng tá»•ng há»£p theo agent/feature â‡’ cÃ³ dÃ²ng cá»§a agent nÃ y.
    const [d] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.usage_daily_dim
      where tenant_id = ${T.acme} and agent_id = ${agentId} and feature = 'contracts.price_scout' and app = 'contracts'`;
    expect(d?.n).toBe(1);
    const cfg = await call(P.hoa, "GET", `/products/${pid}/price-scout`);
    expect(cfg.json.usage).toMatchObject({ searches: 1, tokens: 20 });
  });

  it("tráº§n thÃ¡ng: quáº£n lÃ½ Ä‘áº·t tráº§n = Ä‘Ã£ dÃ¹ng â‡’ lÆ°á»£t káº¿ 429 SCOUT_MONTHLY_CAP, khÃ´ng gá»i agent", async () => {
    expect(
      (await call(P.hoa, "PUT", "/price-scout/quota", { searches_month: 1, tokens_month: null }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(P.lan, "PUT", "/price-scout/quota", {
          searches_month: 1,
          tokens_month: null,
          platform_searches_month: 9,
        })
      ).status,
    ).toBe(403);
    const q = await call(P.lan, "PUT", "/price-scout/quota", {
      searches_month: 1,
      tokens_month: null,
    });
    expect(q.status).toBe(200);
    expect(q.json.usage).toMatchObject({ searches: 1, searches_limit: 1 });
    const n = c.ai.calls.length;
    const r = await call(P.hoa, "POST", `/products/${pid}/suppliers/search`, {});
    expect({ status: r.status, code: r.json?.code ?? r.json?.error?.code }).toEqual({
      status: 429,
      code: "SCOUT_MONTHLY_CAP",
    });
    expect(c.ai.calls).toHaveLength(n);
    await call(P.lan, "PUT", "/price-scout/quota", { searches_month: null, tokens_month: null });
  });

  it("vÃ²ng theo lá»‹ch: chá»‰ SP tá»›i háº¡n + báº­t; lÆ°u giÃ¡ market + cáº£nh bÃ¡o vÃ o Cáº§n xá»­ lÃ½; lá»‹ch káº¿ +7 ngÃ y", async () => {
    const off = await seedProduct(c, { tenant: T.acme, name: "SP lá»‹ch off", avgCost: 100_000 });
    const dis = await seedProduct(c, { tenant: T.acme, name: "SP táº¯t", avgCost: 100_000 });
    const later = await seedProduct(c, {
      tenant: T.acme,
      name: "SP chÆ°a tá»›i háº¡n",
      avgCost: 100_000,
    });
    const def = await call(P.lan, "PUT", "/price-scout/defaults", {
      group: "goods",
      config: {
        enabled: true,
        keywords: [],
        spec: null,
        unit: null,
        include_sites: [],
        exclude_sites: [],
        watched_suppliers: [],
        region: null,
        vat: "excl",
        schedule: "weekly",
        alert_pct: 10,
        alert_watched: false,
      },
    });
    expect(def.status).toBe(200);
    await call(P.hoa, "PUT", `/products/${off}/price-scout`, { schedule: "off" });
    await call(P.hoa, "PUT", `/products/${dis}/price-scout`, { enabled: false });
    await c.sql`update contracts.price_scout_configs set next_at = now() + interval '3 days' where product_id = ${later}`;
    const db = c.hub.db;
    const agents = createAgentCaller(
      createHubAiClient(db, { provider: c.ai.provider }),
      agentSpecOf(db),
    );
    const s = createPriceScoutScheduler(
      db,
      {
        agents,
        quota: async () => {},
        timeZoneOf: async () => "Asia/Ho_Chi_Minh",
        tenants: async () => [],
      },
      { concurrency: 5, daily: 50, systemSearches: 300, leaseS: 300 },
    );
    c.ai.next = { text: REPLY };
    c.ai.calls.length = 0;
    expect(await s.tenantOnce(T.acme)).toBe(1); // chá»‰ `pid` (káº¿ thá»«a weekly + báº­t, chÆ°a dÃ²)
    expect(JSON.parse(c.ai.calls[0]?.prompt as string).product).toBe("USB Token kÃ½ sá»‘");
    const rows = await c.sql<Json[]>`select product_id, last_status, lease_until is null as free,
        next_at > now() + interval '6 days' as weekly from contracts.price_scout_configs where tenant_id = ${T.acme}
        and last_at is not null`;
    expect([...rows]).toEqual([{ product_id: pid, last_status: "ok", free: true, weekly: true }]);
    const prices = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.product_supplier_prices
      where product_id = ${pid} and source = 'market' and created_by is null`;
    expect(prices[0]?.n).toBe(2);
    const [usage] = await c.sql<Json[]>`select trigger_kind, user_id from hub.usage_logs
      where feature = 'contracts.price_scout' order by at desc limit 1`;
    expect(usage).toEqual({ trigger_kind: "schedule", user_id: null });
    expect(await s.tenantOnce(T.acme)).toBe(0); // khÃ´ng cÃ²n SP tá»›i háº¡n
    const todo = await call(P.hoa, "GET", "/my-work/todo");
    const alert = todo.json.items.find((i: Json) => i.kind === "market_price");
    expect(alert).toMatchObject({
      product_id: pid,
      title: "USB Token kÃ½ sá»‘",
      party: "FPT IS",
      amount: 80_000,
    });
  });
});
