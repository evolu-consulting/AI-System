// CR-118 · UW-FR-04 · UW-FR-05 (N3) · UW-FR-16..19 · int: `GET /pack/me` + `GET /hub-admin/tenants/:id/capabilities` trên hub-api
// THẬT (khung N1, gói `pkdemo`). Ma trận quyền (platform admin / tenant admin mình–khác / member / đối tác ⇒ chặn), chặn chéo
// tenant, ETag/304, số câu SQL (0 khi nóng, cố định khi nạp lại), sự kiện `config.changed` qua `/me/stream` khi cấu hình đổi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sign } from "../H1/_fixtures";
import {
  bumpConfig,
  type CtxN1,
  countHops,
  needPackKit,
  P,
  PK,
  startN1,
  T,
  untilHubSettles,
} from "../N1/_support/n1";
import { openMeStream } from "../X2a/_x2a";

let c: CtxN1;
const XORG = "a5e10000-0000-4000-8000-0000000000ee";
const capsPath = (tid: string) => `/hub-admin/tenants/${tid}/capabilities`;
const get = async (token: string | null, path: string, h: Record<string, string> = {}) => {
  const headers: Record<string, string> = { ...h };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${c.hub.base}${path}`, { headers });
  const text = await r.text();
  return { status: r.status, etag: r.headers.get("etag"), json: text ? JSON.parse(text) : null };
};
const partnerTok = () =>
  sign(c.k, P.hoa, {
    claims: { tid: P.hoa.tid, role: "member", sid: null, kind: "external", xorg: XORG },
  });

beforeAll(async () => {
  c = await startN1();
  await needPackKit(c.sql);
  await c.enable(T.acme);
  await c.addToRole(T.acme, "editor", [P.hoa]);
  const tok = await c.tok(P.hoa);
  await untilHubSettles(
    c.hub,
    async () => (await get(tok, "/pack/me")).json,
    (j) => j?.packs?.[PK]?.actions?.includes("write") === true,
  );
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("CR-118 · capabilities — ma trận quyền", () => {
  it("UW-FR-17 · platform admin mọi tenant, tenant admin chỉ tenant mình, member/đối tác/không token bị chặn", async () => {
    const got = {
      padmin_acme: (await get(await c.tok(P.padmin), capsPath(T.acme))).status,
      padmin_beta: (await get(await c.tok(P.padmin), capsPath(T.beta))).status,
      tadmin_own: (await get(await c.tok(P.tadmin), capsPath(T.acme))).status,
      tadmin_other: (await get(await c.tok(P.tadmin), capsPath(T.beta))).status,
      member: (await get(await c.tok(P.hoa), capsPath(T.acme))).status,
      partner: (await get(await partnerTok(), capsPath(T.acme))).status,
      anon: (await get(null, capsPath(T.acme))).status,
      padmin_unknown: (
        await get(await c.tok(P.padmin), capsPath("a5e10000-0000-4000-8000-0000000000ff"))
      ).status,
      padmin_bad_id: (await get(await c.tok(P.padmin), capsPath("x"))).status,
    };
    expect(got).toEqual({
      padmin_acme: 200,
      padmin_beta: 200,
      tadmin_own: 200,
      tadmin_other: 403,
      member: 403,
      partner: 403,
      anon: 401,
      padmin_unknown: 404,
      padmin_bad_id: 404,
    });
  });

  it("UW-FR-17 · chéo tenant: view acme có gói bật, beta thì tắt, tenant_id đúng tenant hỏi", async () => {
    const tok = await c.tok(P.padmin);
    const a = (await get(tok, capsPath(T.acme))).json;
    const b = (await get(tok, capsPath(T.beta))).json;
    expect(a.tenant_id).toBe(T.acme);
    expect(b.tenant_id).toBe(T.beta);
    expect(a.apps.find((x: { key: string }) => x.key === PK)?.level).not.toBe("off");
    expect(b.apps.find((x: { key: string }) => x.key === PK)?.level).toBe("off");
  });
});

describe("CR-118 · UW-FR-04 · /pack/me", () => {
  it("lát cắt user: gói + mức + flags, beta (chéo tenant) không thấy gói của acme, đối tác 200 nhưng gói không mở cho đối tác ⇒ tắt", async () => {
    const hoa = (await get(await c.tok(P.hoa), "/pack/me")).json;
    expect(hoa.packs[PK]).toEqual({ enabled: true, level: "write", actions: ["read", "write"] });
    expect(hoa.flags[PK]).toBe(true);
    expect(hoa.user).toMatchObject({ id: P.hoa.id, tenant_id: T.acme, kind: "internal" });
    const an = (await get(await c.tok(P.an), "/pack/me")).json;
    expect(an.packs[PK]?.enabled ?? false).toBe(false);
    expect(an.apps).not.toContain(PK);
    const ext = await get(await partnerTok(), "/pack/me");
    expect(ext.status).toBe(200);
    expect(ext.json.user.kind).toBe("external");
    expect(ext.json.packs[PK]).toEqual({ enabled: false, level: "off", actions: [] });
  });

  it("ETag/304 + 0 SQL khi nóng, đổi cấu hình ⇒ ETag mới", async () => {
    const tok = await c.tok(P.hoa);
    const first = await get(tok, "/pack/me");
    expect(first.etag).toMatch(/^"a\d+\.h\d+\.[0-9a-z]+"$/);
    const warm = await countHops(c, () => get(tok, "/pack/me"));
    const nm = await countHops(c, () =>
      get(tok, "/pack/me", { "if-none-match": first.etag ?? "" }),
    );
    expect({ warm: warm.sql, notModified: nm.sql, status: nm.r.status }).toEqual({
      warm: 0,
      notModified: 0,
      status: 304,
    });
    await bumpConfig(c.sql, T.acme);
    const after = await untilHubSettles(
      c.hub,
      () => get(tok, "/pack/me", { "if-none-match": first.etag ?? "" }),
      (r) => r.status === 200,
    );
    expect(after.etag).not.toBe(first.etag);
  });

  it("capabilities: ETag/304, 0 SQL khi nóng, ≤ 3 câu khi phần Hub nạp lại", async () => {
    const tok = await c.tok(P.padmin);
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1`;
    const [v] = await c.sql<{ v: number }[]>`select hub_config_version as v from hub.config_meta`;
    await c.sql`select pg_notify('hub_config_changed', json_build_object('v', 1, 'version', ${v?.v ?? 1}::int)::text)`;
    // chờ ảnh Hub mới qua `/pack/me` (không nạp phần khe) rồi mới đếm lần đầu của capabilities ⇒ chỉ đếm câu của view
    await untilHubSettles(
      c.hub,
      async () => (await get(await c.tok(P.hoa), "/pack/me")).json,
      (j) => j?.versions?.hub === v?.v,
    );
    const cold = await countHops(c, () => get(tok, capsPath(T.acme)));
    expect(cold.r.json?.versions?.hub).toBe(v?.v);
    console.log(`CR-118 capabilities nạp lại phần Hub: ${cold.sql} câu`, cold.queries);
    const warm = await countHops(c, () => get(tok, capsPath(T.acme)));
    const nm = await countHops(c, () =>
      get(tok, capsPath(T.acme), { "if-none-match": warm.r.etag ?? "" }),
    );
    expect({ cold: cold.sql <= 3, warm: warm.sql, nm: nm.sql, nmStatus: nm.r.status }).toEqual({
      cold: true,
      warm: 0,
      nm: 0,
      nmStatus: 304,
    });
  });
});

describe("CR-118 · N3 · /me/stream config.changed", () => {
  it("cấu hình acme đổi ⇒ phiên acme nhận config.changed (kèm versions), phiên beta không nhận", async () => {
    const sa = await openMeStream(c.hub, await c.tok(P.hoa));
    const sb = await openMeStream(c.hub, await c.tok(P.an));
    expect({ a: sa.status, b: sb.status }).toEqual({ a: 200, b: 200 });
    try {
      // phiên đã đăng ký khi header về (session.start đồng bộ tới `conns.add`)
      await bumpConfig(c.sql, T.acme);
      const ev = await sa.until((e) => e.event === "config.changed", 5_000);
      expect(ev?.data).toMatchObject({ admin: expect.any(Number), hub: expect.any(Number) });
      expect(ev?.id ?? null).toBeNull();
      // mốc: đổi cấu hình beta ⇒ sb nhận; nếu frame của acme từng tới sb thì nó đến TRƯỚC (cùng kết nối, có thứ tự)
      await bumpConfig(c.sql, T.beta);
      const evB = await sb.until((e) => e.event === "config.changed", 5_000);
      expect({
        got: evB !== undefined,
        closed: sb.isClosed(),
        ct: sb.headers.get("content-type"),
        head: sb.text().slice(0, 120),
      }).toMatchObject({ got: true });
      expect(evB?.data.admin).toBeGreaterThan(ev?.data.admin);
      expect(sb.events.filter((e) => e.event === "config.changed").length).toBe(1);
    } finally {
      sa.close();
      sb.close();
    }
  });
});
