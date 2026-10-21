// agents-background · cờ `hub.agents.surface` (chat | background): `/agent-settings` trả cả hai loại đúng cờ; bật/tắt agent nền theo
// công ty chỉ platform_admin; agent nền không cấp quyền được; price-scout bị tắt ⇒ lượt dò tay 409 SCOUT_AGENT_DISABLED (0 lời gọi AI,
// không giữ lượt tháng) và vòng dò theo lịch bỏ qua tenant đó. Hạ tầng: hub-api + admin-api thật (V2-J2), AI giả tất định.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAgentCaller } from "../../../apps/hub-api/src/lib/ai-client/agent-call";
import { createHubAiClient } from "../../../apps/hub-api/src/lib/ai-client/ai-client.env";
import { agentSpecOf } from "../../../apps/hub-api/src/modules/agents/agent-spec.service";
import { createPriceScoutScheduler } from "../../../apps/hub-api/src/modules/packs/contracts/price-scout.mount";
import {
  BASE,
  type CtxJ2,
  type Json,
  P,
  seedProduct,
  seedScoutAgent,
  startJ2,
  T,
} from "../V2-J2/_support/v2j2";

let c: CtxJ2;
let scoutId: string;
let chatId: string;
let pid: string;
type Person = (typeof P)[keyof typeof P];
const hub = (p: Person, m: string, path: string, body?: unknown) => c.hubCall(p, m, path, body);
const REPLY = JSON.stringify({
  items: [{ supplier_name: "FPT IS", kind: "new", price: 80_000, url: "https://fpt.vn/token" }],
});
const code = (r: Json): string | undefined => r.json?.error?.code ?? r.json?.code;
const listAs = async (p: Person) =>
  (await hub(p, "GET", `/agent-settings?tenant_id=${T.acme}`)).json.agents as Json[];

beforeAll(async () => {
  c = await startJ2();
  await c.sql`truncate contracts.products cascade`;
  await c.sql`truncate contracts.price_scout_usage, contracts.price_scout_quota, contracts.price_scout_defaults`;
  scoutId = await seedScoutAgent(c);
  await c.sql`update hub.agents set surface = 'background', serves = ${JSON.stringify({
    app: "contracts",
    label: { vi: "Sổ Hợp Tác › Dò giá", en: "Ledger › Price scout" },
  })}::text::jsonb where id = ${scoutId}`;
  const [a] = await c.sql<
    { id: string }[]
  >`insert into hub.agents (key, name, description, runtime, profile_id, system_prompt)
    select 'qc-chat', ${JSON.stringify({ vi: "Chat QC", en: "QC chat" })}::text::jsonb,
      'Agent chat thường cho test agents-background', 'agentic-cli', id, 'SYS' from hub.model_profiles where key = 'fake-1'
    on conflict (key) do update set surface = 'chat' returning id`;
  chatId = a?.id as string;
  await c.sql`insert into hub.agent_entitlements (agent_id, tenant_id) values (${chatId}, ${T.acme}) on conflict do nothing`;
  pid = await seedProduct(c, { tenant: T.acme, name: "USB Token ky so", avgCost: 100_000 });
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe("agents-background", () => {
  it("list trả cả hai loại đúng cờ; agent nền mặc định bật cho công ty (kể cả tenant_admin)", async () => {
    for (const who of [P.padmin, P.tadmin]) {
      const items = await listAs(who);
      const bg = items.find((i) => i.agent.id === scoutId);
      expect(bg).toMatchObject({
        surface: "background",
        serves: { app: "contracts" },
        entitled: true,
      });
      expect(items.find((i) => i.agent.id === chatId)).toMatchObject({
        surface: "chat",
        serves: null,
        entitled: true,
      });
    }
  });

  it("tenant_admin không bật/tắt được (403); agent nền không cấp quyền được (409)", async () => {
    const put = (p: Person, entitled: boolean) =>
      hub(p, "PUT", `/agent-settings/entitlements?tenant_id=${T.acme}`, {
        agent_id: scoutId,
        entitled,
      });
    const r = await put(P.tadmin, false);
    expect({ status: r.status, code: code(r) }).toEqual({ status: 403, code: "FORBIDDEN" });
    expect((await listAs(P.padmin)).find((i) => i.agent.id === scoutId)?.entitled).toBe(true);
    const g = await hub(P.tadmin, "POST", `/agent-grants?tenant_id=${T.acme}`, {
      agent_id: scoutId,
      subject_type: "tenant",
      subject_id: T.acme,
    });
    expect({ status: g.status, code: code(g) }).toEqual({
      status: 409,
      code: "AGENT_NOT_GRANTABLE",
    });
  });

  it("tắt price-scout cho công ty ⇒ dò tay 409 rõ ràng, 0 lời gọi AI, không giữ lượt; vòng lịch bỏ qua tenant; bật lại chạy", async () => {
    const off = await hub(P.padmin, "PUT", `/agent-settings/entitlements?tenant_id=${T.acme}`, {
      agent_id: scoutId,
      entitled: false,
    });
    expect(off.status).toBe(200);
    expect((await listAs(P.padmin)).find((i) => i.agent.id === scoutId)?.entitled).toBe(false);
    c.ai.next = { text: REPLY };
    c.ai.calls.length = 0;
    const r = await hub(P.hoa, "POST", `${BASE}/products/${pid}/suppliers/search`, {});
    expect({ status: r.status, code: code(r) }).toEqual({
      status: 409,
      code: "SCOUT_AGENT_DISABLED",
    });
    expect(c.ai.calls).toHaveLength(0);
    const [u] = await c.sql<
      { n: number }[]
    >`select coalesce(sum(manual), 0)::int as n from contracts.price_scout_usage`;
    expect(u?.n).toBe(0);

    // vòng theo lịch: SP tới hạn nhưng agent tắt ⇒ bỏ qua tenant (0 SP, 0 lời gọi, SP vẫn tới hạn)
    await hub(P.lan, "PUT", `${BASE}/price-scout/defaults`, {
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
    expect(await s.tenantOnce(T.acme)).toBe(0);
    expect(c.ai.calls).toHaveLength(0);

    await hub(P.padmin, "PUT", `/agent-settings/entitlements?tenant_id=${T.acme}`, {
      agent_id: scoutId,
      entitled: true,
    });
    expect(await s.tenantOnce(T.acme)).toBe(1);
    expect(c.ai.calls).toHaveLength(1);
  });
});
