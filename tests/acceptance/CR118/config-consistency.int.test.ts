// CR-118 · cr118-config-consistency · int trên hub-api + admin-api THẬT (khung N1, gói `pkdemo` + `community`):
// (1) hub_api chỉ SELECT `packs.pack_agents` (ghi bị chặn) và agent của app đọc từ bảng qua ConfigCache (0 SQL khi nóng);
// (2) brand công ty (tên = admin.tenants.name đổi qua admin-api, c20) và `default_app` bump `config_version` CÙNG transaction ⇒ ETag `/pack/me` đổi + `config.changed` tới đúng
// tenant trong một vòng LISTEN; `home` theo default_app khi user đọc được gói đó, không thì theo quyền; tenant khác không bị chạm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxN1,
  countHops,
  hubApiSql,
  needPackKit,
  P,
  PK,
  pgCode,
  startN1,
  T,
  untilHubSettles,
} from "../N1/_support/n1";
import { openMeStream } from "../X2a/_x2a";

let c: CtxN1;
const capsPath = (tid: string) => `/hub-admin/tenants/${tid}/capabilities`;
const get = async (token: string, path: string, h: Record<string, string> = {}) => {
  const r = await fetch(`${c.hub.base}${path}`, {
    headers: { ...h, authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  return { status: r.status, etag: r.headers.get("etag"), json: text ? JSON.parse(text) : null };
};
const me = async (p: typeof P.hoa) => get(await c.tok(p), "/pack/me");
const AGENT = "cfgc-pack-agent";
let agentKey = "";

const bumpHub = async () => {
  const [v] = await c.sql<{ v: number }[]>`update hub.config_meta
    set hub_config_version = hub_config_version + 1 where id = 1 returning hub_config_version as v`;
  await c.sql`select pg_notify('hub_config_changed', json_build_object('v', 1, 'version', ${v?.v ?? 1}::int)::text)`;
  return v?.v ?? 0;
};
// CR-121 c20: tên công ty đổi ở ADMIN (admin.tenants.name, qua admin-api ⇒ config_changed kèm tenant_id); app_name là brand riêng của gói.
const setBrand = async (tid: string, name: string) => {
  await c.sql`insert into contracts.company_settings (tenant_id, app_name)
    values (${tid}, ${name}) on conflict (tenant_id) do update set app_name = excluded.app_name`;
};
const renameTenant = async (tid: string, name: string) => {
  const t = (await c.admin.call("GET", `/admin/tenants/${tid}`)).json;
  const r = await c.admin.call("PATCH", `/admin/tenants/${tid}`, { version: t.version, name });
  expect({ status: r.status }).toEqual({ status: 200 });
};
const setTenantDefault = async (tid: string, app: string | null) => {
  const r = await c.admin.call("PUT", `/admin/tenants/${tid}/default-app`, { app });
  expect({ status: r.status }).toEqual({ status: 200 });
};

beforeAll(async () => {
  c = await startN1();
  await needPackKit(c.sql);
  await c.sql`insert into admin.app_catalog (key, name, icon, audience, required_feature, sso, sort_order)
    values (${PK}, '{"vi": "Demo", "en": "Demo"}', 'box', 'all', ${`${PK}-read`}, true, 90)
    on conflict (key) do nothing`;
  await c.sql`update admin.tenants set default_app = null where id in (${T.acme}, ${T.beta})`;
  await c.enable(T.acme);
  await c.enable(T.acme, "community");
  await c.addToRole(T.acme, "editor", [P.hoa]);
  await c.addToRole(T.acme, "viewer", [P.hoa], "community");
  // agent Hub tối thiểu của riêng file này (mẫu DB không có agent)
  agentKey = AGENT;
  await c.sql`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
    values (${AGENT}, 'subscription', 'fake', 1, true, true) on conflict do nothing`;
  const [p] = await c.sql<{ id: string }[]>`insert into hub.model_profiles (key, steps)
    values (${AGENT}, ${c.sql.json([{ provider_key: AGENT, model: null, on: [] }])}) returning id`;
  await c.sql`insert into hub.agents (key, name, description, runtime, profile_id)
    values (${AGENT}, ${c.sql.json({ vi: "Agent gói", en: "Pack agent" })}, 'cr118 config-consistency',
      'agentic-cli', ${p?.id as string}) on conflict (key) do nothing`;
  await untilHubSettles(
    c.hub,
    async () => (await me(P.hoa)).json,
    (j) => j?.apps?.includes(PK) && j?.apps?.includes("community"),
  );
}, 60_000);
afterAll(async () => {
  if (c) {
    await c.sql`delete from packs.pack_agents where pack_key = ${PK}`;
    await c.sql`delete from hub.agents where key = ${AGENT}`;
    await c.sql`delete from hub.model_profiles where key = ${AGENT}`;
    await c.sql`delete from hub.providers where key = ${AGENT}`;
    await c.sql`update admin.tenants set default_app = null where id in (${T.acme}, ${T.beta})`;
    await c.stop();
  }
});

describe("CR-118 · config-consistency · packs.pack_agents cho hub_api", () => {
  it("hub_api: SELECT được, INSERT/UPDATE/DELETE bị chặn (42501)", async () => {
    const h = hubApiSql();
    try {
      const sel = await pgCode(() => h`select pack_key, agent_key from packs.pack_agents limit 1`);
      const ins = await pgCode(
        () => h`insert into packs.pack_agents (pack_key, agent_key) values (${PK}, 'x-denied')`,
      );
      const upd = await pgCode(() => h`update packs.pack_agents set agent_key = agent_key`);
      const del = await pgCode(() => h`delete from packs.pack_agents where false`);
      expect({ sel, ins, upd, del }).toEqual({
        sel: null,
        ins: "42501",
        upd: "42501",
        del: "42501",
      });
    } finally {
      await h.end();
    }
  });

  it("agent của app đọc từ bảng (thẻ pkdemo có agent vừa khai, không còn ở Dùng chung), nóng 0 SQL", async () => {
    await c.sql`insert into packs.pack_agents (pack_key, agent_key) values (${PK}, ${agentKey})
      on conflict do nothing`;
    const v = await bumpHub();
    const tok = await c.tok(P.padmin);
    const r = await untilHubSettles(
      c.hub,
      () => get(tok, capsPath(T.acme)),
      (x) => x.json?.versions?.hub === v,
    );
    const card = r.json.apps.find((x: { key: string }) => x.key === PK);
    const keys = (xs: { key: string }[]) => xs.map((x) => x.key);
    expect({
      inCard: keys(card?.agents ?? []).includes(agentKey),
      inShared: keys(r.json.shared.agents).includes(agentKey),
    }).toEqual({ inCard: true, inShared: false });
    const warm = await countHops(c, () => get(tok, capsPath(T.acme)));
    expect({ warm: warm.sql, status: warm.r.status }).toEqual({ warm: 0, status: 200 });
  });
});

describe("CR-118 · config-consistency · brand + default_app bump version", () => {
  it("đổi brand acme ⇒ config.changed tới phiên acme, ETag + brand mới, beta không nhận, brand beta giữ nguyên, nóng 0 SQL", async () => {
    await setBrand(T.beta, "Beta App");
    await renameTenant(T.beta, "Beta Co");
    const bBefore = await untilHubSettles(
      c.hub,
      () => me(P.an),
      (x) => x.json?.brand?.name === "Beta Co",
    );
    await setBrand(T.acme, "Acme App");
    await untilHubSettles(
      c.hub,
      () => me(P.hoa),
      (x) => x.json?.brand?.app_name === "Acme App",
    );
    const first = await me(P.hoa);
    const sa = await openMeStream(c.hub, await c.tok(P.hoa));
    const sb = await openMeStream(c.hub, await c.tok(P.an));
    try {
      await renameTenant(T.acme, `Acme ${Date.now() % 100000}`);
      const ev = await sa.until((e) => e.event === "config.changed", 5_000);
      expect({ got: ev?.event ?? null }).toEqual({ got: "config.changed" });
      const tok = await c.tok(P.hoa);
      const after = await get(tok, "/pack/me", { "if-none-match": first.etag ?? "" });
      expect({ status: after.status, etagChanged: after.etag !== first.etag }).toEqual({
        status: 200,
        etagChanged: true,
      });
      expect(after.json.brand.name).toMatch(/^Acme \d+$/);
      // mốc có thứ tự trên kết nối beta: đổi beta ⇒ sb nhận đúng MỘT frame (của beta)
      await renameTenant(T.beta, "Beta Co 2");
      await sb.until((e) => e.event === "config.changed", 5_000);
      expect(sb.events.filter((e) => e.event === "config.changed").length).toBe(1);
      expect(bBefore.json.brand.name).toBe("Beta Co");
      const warm = await countHops(c, () => get(tok, "/pack/me"));
      expect({ warm: warm.sql }).toEqual({ warm: 0 });
    } finally {
      sa.close();
      sb.close();
    }
  });

  it("đổi default_app công ty ⇒ home theo default_app khi user đọc được gói đó, app không phải gói ⇒ theo quyền, beta không đổi", async () => {
    const before = await me(P.hoa);
    expect(before.json.home).toBe("community");
    const beta0 = (await me(P.an)).json.home;
    const sa = await openMeStream(c.hub, await c.tok(P.hoa));
    try {
      await setTenantDefault(T.acme, PK);
      await sa.until((e) => e.event === "config.changed", 5_000);
      const on = await me(P.hoa);
      expect({ home: on.json.home, etagChanged: on.etag !== before.etag }).toEqual({
        home: PK,
        etagChanged: true,
      });
      expect((await me(P.an)).json.home).toBe(beta0);
      await setTenantDefault(T.acme, "chat");
      const off = await untilHubSettles(
        c.hub,
        () => me(P.hoa),
        (x) => x.json?.home !== PK,
      );
      expect(off.json.home).toBe("community");
    } finally {
      sa.close();
    }
  });
});
