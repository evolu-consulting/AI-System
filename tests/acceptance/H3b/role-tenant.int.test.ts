// ADM-FR-37 · HUB-BR-14 · H3b-R01–R03 · HUB-H3b-AC-01 · test-plan-cases H3b §2.1 A01–A14: role + tenant đích trên 4 endpoint
// `/agent-grants*` (GET list, POST, DELETE, GET effective) — 401 trước, member 403 trước validate, tenant_admin chỉ tenant
// mình (404 giống hệt), platform_admin bắt buộc `tenant_id`. Mọi lỗi: 0 ghi ở cả hai tenant + không NOTIFY.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AgentGrantListResponseSchema } from "@ai/contracts/hub-admin";
import { call, R, type Res, sign } from "../H1/_fixtures";
import {
  AGT,
  auditSince,
  type Ctx,
  delGrant,
  e,
  errOf,
  expectNoWrite,
  expectSame404,
  GRP,
  type GrantRef,
  grantRow,
  insertGrant,
  listenHub,
  listGrants,
  NONE,
  type Notes,
  postGrant,
  qs,
  startH3b,
  stateOf,
  T,
  tok,
  USERS,
  userOf,
} from "./_h3b";

let x: Ctx;
let n: Notes;
beforeAll(async () => {
  x = await startH3b();
  n = await listenHub();
}, 60_000);
afterAll(async () => {
  await n?.close();
  await x?.stop();
});

const G_ACME: GrantRef = { agent: AGT.hoadon, type: "group", subject: GRP.keToan };
const G_BETA: GrantRef = { agent: AGT.khodu, type: "group", subject: GRP.banHang };
type Ep = { name: string; method: string; path: string; body?: unknown };
/** 4 endpoint với query chung `q` (+ `body` POST tuỳ biến). */
function eps(
  q: Record<string, string | undefined>,
  g: GrantRef = G_ACME,
  postBody?: unknown,
): Ep[] {
  const gq = { agent_id: g.agent, subject_type: g.type, subject_id: g.subject };
  return [
    { name: "list", method: "GET", path: `/agent-grants${qs(q)}` },
    {
      name: "post",
      method: "POST",
      path: `/agent-grants${qs(q)}`,
      body: postBody ?? { agent_id: g.agent, subject_type: g.type, subject_id: g.subject },
    },
    { name: "delete", method: "DELETE", path: `/agent-grants${qs({ ...q, ...gq })}` },
    { name: "effective", method: "GET", path: `/agent-grants/effective/${USERS.lan.id}${qs(q)}` },
  ];
}
const run = (ep: Ep, token?: string): Promise<Res> =>
  call(x.hub, ep.method, ep.path, { token, body: ep.body });
async function runAll(list: Ep[], token?: string) {
  const out: { name: string; err: ReturnType<typeof errOf> }[] = [];
  for (const ep of list) out.push({ name: ep.name, err: errOf(await run(ep, token)) });
  return out;
}
const all = (list: Ep[], err: ReturnType<typeof e>) => list.map((ep) => ({ name: ep.name, err }));

describe("A01–A02 · 401 / member 403 trước validate [ADM-FR-37 · H3b-R01 · HUB-H3b-AC-01]", () => {
  it("ADM-FR-37 · A01 · không token · token hết hạn · ký khoá khác (4 endpoint + trace) ⇒ 401 AUTH_EXPIRED; 0 ghi [H3b-R01 · HUB-H3b-AC-01]", async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const list = [...eps({}), { name: "trace", method: "GET", path: `/runs/${R.runDone}/trace` }];
    const lan = USERS.lan;
    for (const token of [
      undefined,
      await sign(x.k, lan, { expS: -60 }),
      await sign(x.k, lan, { key: x.k.other }),
    ])
      expect(await runAll(list, token)).toEqual(all(list, e(401, "AUTH_EXPIRED")));
    await expectNoWrite(x.sql, n, m, s0);
  });

  it("ADM-FR-37 · A02 · lan (member): hợp lệ · body sai · ?tenant_id=xyz · ?tenant_id=beta ⇒ 403 FORBIDDEN (trước validate — PL8); 0 ghi [H3b-R01 · HUB-H3b-AC-01]", async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const t = await tok(x.k, "lan");
    for (const list of [
      eps({}),
      eps({}, G_ACME, { nope: 1 }),
      eps({ tenant_id: "xyz" }),
      eps({ tenant_id: T.beta }),
    ])
      expect(await runAll(list, t)).toEqual(all(list, e(403, "FORBIDDEN")));
    await expectNoWrite(x.sql, n, m, s0);
  });

  it('ADM-FR-37 · A02b · JWT ký đúng nhưng role "owner" ⇒ 401 AUTH_EXPIRED (N2: jwt.ts từ chối role lạ); 0 ghi [H3b-R01]', async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const lan = USERS.lan;
    const t = await sign(x.k, lan, { claims: { tid: lan.tid, role: "owner", sid: null } });
    const list = eps({});
    expect(await runAll(list, t)).toEqual(all(list, e(401, "AUTH_EXPIRED")));
    await expectNoWrite(x.sql, n, m, s0);
  });
});

describe("A03–A06 · tenant đích [ADM-FR-37 · HUB-BR-14 · H3b-R02, R03]", () => {
  it("HUB-BR-14 · A03 · tadmin ?tenant_id=beta (body hợp lệ cho beta) ⇒ 404 ≡ ?tenant_id=<không có>; 0 ghi ở beta và acme [H3b-R02 · G1]", async () => {
    await insertGrant(x.sql, T.beta, G_BETA);
    try {
      const t = await tok(x.k, "tadmin");
      // đối chứng: endpoint có thật (404 dưới đây không phải "route chưa có")
      expect((await listGrants(x, "tadmin")).status).toBe(200);
      const s0 = await stateOf(x.sql);
      const m = n.mark();
      const a = eps({ tenant_id: T.beta }, G_BETA);
      const b = eps({ tenant_id: NONE }, G_BETA);
      for (const [i, ep] of a.entries()) {
        const rb = b[i];
        if (rb) expectSame404(await run(ep, t), await run(rb, t));
      }
      await expectNoWrite(x.sql, n, m, s0);
    } finally {
      await x.sql`delete from hub.agent_grants where tenant_id = ${T.beta}`;
    }
  });

  it("ADM-FR-37 · A04 · tadmin ?tenant_id=acme ⇒ như không gửi (GET 200, POST 201, DELETE 204, effective 200) [H3b-R02]", async () => {
    const t = await tok(x.k, "tadmin");
    const got: number[] = [];
    for (const ep of eps({ tenant_id: T.acme })) got.push((await run(ep, t)).status);
    expect(got).toEqual([200, 201, 204, 200]);
    expect(await grantRow(x.sql, T.acme, G_ACME)).toBeUndefined();
  });

  it("ADM-FR-37 · A05 · padmin không tenant_id ⇒ 400 TENANT_REQUIRED; 0 ghi [H3b-R02]", async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const list = eps({});
    expect(await runAll(list, await tok(x.k, "padmin"))).toEqual(
      all(list, e(400, "TENANT_REQUIRED")),
    );
    await expectNoWrite(x.sql, n, m, s0);
  });

  it("ADM-FR-37 · A06 · padmin ?tenant_id=<không có> ⇒ 404 · ?tenant_id=abc ⇒ 400 VALIDATION_ERROR; 0 ghi [H3b-R02]", async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const t = await tok(x.k, "padmin");
    const none = eps({ tenant_id: NONE });
    expect(await runAll(none, t)).toEqual(all(none, e(404, "NOT_FOUND")));
    const abc = eps({ tenant_id: "abc" });
    // VALIDATION_ERROR luôn kèm details.issues (contract ErrorResponse / lib/http) ⇒ so [status, code] + issues không rỗng.
    const got = await runAll(abc, t);
    expect(got.map((g) => [g.name, g.err.status, g.err.code])).toEqual(
      abc.map((ep) => [ep.name, 400, "VALIDATION_ERROR"]),
    );
    for (const g of got)
      expect((g.err.details as { issues?: unknown[] } | undefined)?.issues?.length).toBeGreaterThan(
        0,
      );
    await expectNoWrite(x.sql, n, m, s0);
  });
});

describe("A07–A10 · platform_admin chọn tenant, cách ly ghi [ADM-FR-37 · HUB-BR-14 · H3b-R02, R03]", () => {
  it("ADM-FR-37 · A07 · padmin ?tenant_id=beta POST khodu → ban-hang ⇒ 201 tenant beta; audit beta/platform_admin; GET acme không đổi; DELETE 204 [H3b-R02 · R16]", async () => {
    const t = await tok(x.k, "padmin");
    const acme0 = (await listGrants(x, "tadmin")).json;
    const a0 = (await stateOf(x.sql)).audit;
    const res = await postGrant(x, "padmin", G_BETA, T.beta);
    expect(res.status).toBe(201);
    expect(res.json?.grant?.tenant_id).toBe(T.beta);
    expect((await grantRow(x.sql, T.beta, G_BETA))?.tenant_id).toBe(T.beta);
    const [row] = await auditSince(x.sql, a0, { action: "grant" });
    expect({ tenant: row?.tenant_id, role: row?.actor_role, actor: row?.actor_id }).toEqual({
      tenant: T.beta,
      role: "platform_admin",
      actor: USERS.padmin.id,
    });
    const list = await call(x.hub, "GET", `/agent-grants${qs({ tenant_id: T.beta })}`, {
      token: t,
    });
    expect(list.status).toBe(200);
    expect(AgentGrantListResponseSchema.parse(list.json).tenant_id).toBe(T.beta);
    expect((await listGrants(x, "tadmin")).json?.items).toEqual(acme0?.items);
    expect((await delGrant(x, "padmin", G_BETA, T.beta)).status).toBe(204);
    expect(await grantRow(x.sql, T.beta, G_BETA)).toBeUndefined();
  });

  it("ADM-FR-37 · A08 · padmin ?tenant_id=acme POST subject ban-hang (beta) ⇒ 400 INVALID_REFERENCE {field: subject_id} [H3b-R03, R04]", async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const res = await postGrant(x, "padmin", { ...G_ACME, subject: GRP.banHang }, T.acme);
    expect(errOf(res)).toEqual(e(400, "INVALID_REFERENCE", { field: "subject_id" }));
    await expectNoWrite(x.sql, n, m, s0);
  });

  it("ADM-FR-37 · A09 · tadmin POST body có tenant_id: beta ⇒ 400 VALIDATION_ERROR; 0 ghi [H3b-R02]", async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const res = await call(x.hub, "POST", "/agent-grants", {
      token: await tok(x.k, "tadmin"),
      body: {
        agent_id: AGT.hoadon,
        subject_type: "group",
        subject_id: GRP.keToan,
        tenant_id: T.beta,
      },
    });
    expect(errOf(res)).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    await expectNoWrite(x.sql, n, m, s0);
  });

  it("HUB-BR-14 · A10 · badmin (beta) DELETE hoadon/group/ke-toan (grant acme có thật) ⇒ 204; hàng acme còn; 0 bump/audit/NOTIFY [H3b-R03, R07]", async () => {
    await insertGrant(x.sql, T.acme, G_ACME);
    try {
      const s0 = await stateOf(x.sql);
      const m = n.mark();
      expect((await delGrant(x, "badmin", G_ACME)).status).toBe(204);
      expect(await grantRow(x.sql, T.acme, G_ACME)).toBeDefined();
      await expectNoWrite(x.sql, n, m, s0);
    } finally {
      await x.sql`delete from hub.agent_grants`;
    }
  });
});

describe("A11–A14 · lọc, validate, platform [ADM-FR-37 · HUB-BR-14 · H3b-R02, R03, R11]", () => {
  it("HUB-BR-14 · A11 · tadmin GET ?subject_type=group&subject_id=<ban-hang> ⇒ 200, mọi grants [], không id beta trong thân [H3b-R03, R11]", async () => {
    await insertGrant(x.sql, T.beta, { agent: AGT.hoadon, type: "group", subject: GRP.banHang });
    try {
      const res = await listGrants(x, "tadmin", { subject_type: "group", subject_id: GRP.banHang });
      expect(res.status).toBe(200);
      const p = AgentGrantListResponseSchema.parse(res.json);
      expect(p.items.length).toBeGreaterThan(0);
      for (const item of p.items) expect(item.grants).toEqual([]);
      for (const id of [GRP.banHang, T.beta, USERS.an.id, AGT.khodu])
        expect(res.text).not.toContain(id);
    } finally {
      await x.sql`delete from hub.agent_grants`;
    }
  });

  it("ADM-FR-37 · A12 · tadmin ?tenant_id=beta + body sai; padmin không tenant_id + body sai ⇒ 400 VALIDATION_ERROR cả hai (G2) [H3b-R02, R04]", async () => {
    const bad = { agent_id: "x", subject_type: "role" };
    const r1 = await call(x.hub, "POST", `/agent-grants${qs({ tenant_id: T.beta })}`, {
      token: await tok(x.k, "tadmin"),
      body: bad,
    });
    const r2 = await call(x.hub, "POST", "/agent-grants", {
      token: await tok(x.k, "padmin"),
      body: bad,
    });
    expect([errOf(r1), errOf(r2)].map((r) => [r.status, r.code])).toEqual([
      [400, "VALIDATION_ERROR"],
      [400, "VALIDATION_ERROR"],
    ]);
  });

  it("ADM-FR-37 · A13 · query khoá lạ ?foo=1 · ?user_id=<lan> ⇒ 400 VALIDATION_ERROR (4 endpoint) [H3b-R02 · PL4]", async () => {
    const t = await tok(x.k, "tadmin");
    for (const q of [{ foo: "1" }, { user_id: USERS.lan.id }]) {
      const list = eps(q);
      const got = await runAll(list, t);
      expect(got.map((g) => [g.name, g.err.status, g.err.code])).toEqual(
        list.map((ep) => [ep.name, 400, "VALIDATION_ERROR"]),
      );
    }
  });

  it("ADM-FR-37 · A14 · padmin ?tenant_id=platform GET ⇒ 200 items [], tenant_id = platform [H3b-R02]", async () => {
    const res = await listGrants(x, "padmin", { tenant_id: T.platform });
    expect(res.status).toBe(200);
    const p = AgentGrantListResponseSchema.parse(res.json);
    expect({ tenant: p.tenant_id, items: p.items }).toEqual({ tenant: T.platform, items: [] });
    expect(userOf("padmin").tid).toBe(T.platform);
  });
});
