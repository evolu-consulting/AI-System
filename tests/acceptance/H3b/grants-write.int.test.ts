// HUB-FR-78 · HUB-BR-17 · H3b-R04–R08, R16 · HUB-H3b-AC-02, AC-03, AC-04 · test-plan-cases H3b §2.2 A20–A41: POST/DELETE
// `/agent-grants` — 201/200 tập hợp, bump `hub_config_version` + audit + NOTIFY trong cùng transaction, thứ tự lỗi R04,
// thu hồi luôn được, audit lỗi ⇒ rollback toàn bộ (tiêm `hubAudit`), `granted_by` hiển thị username.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { HUB_CONTRACT_VERSION } from "@ai/contracts/hub";
import {
  type AgentGrant,
  AgentGrantListResponseSchema,
  AgentGrantWriteResponseSchema,
} from "@ai/contracts/hub-admin";
import type { HubX } from "../H1/_hub";
import {
  AGT,
  auditSince,
  type Ctx,
  delGrant,
  e,
  entitle,
  errOf,
  expectNoWrite,
  failingAudit,
  GRP,
  type GrantRef,
  grantRow,
  insertGrant,
  listenHub,
  listGrants,
  NONE,
  type Notes,
  postGrant,
  revokeEnt,
  startH3b,
  startHubH3b,
  stateOf,
  T,
  tok,
  USERS,
  versionOf,
  type Who,
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

const G: GrantRef = { agent: AGT.hoadon, type: "group", subject: GRP.keToan };
const S = { v0: 0, a0: 0, m0: 0, t2xx: 0, grant: undefined as undefined | AgentGrant };
const gr = (agent: string, type: "group" | "user", subject: string): GrantRef => ({
  agent,
  type,
  subject,
});

describe("A20–A25 · cấp mới / trùng [HUB-FR-78 · H3b-R06, R08, R16 · HUB-H3b-AC-04]", () => {
  it("HUB-FR-78 · A20 · tadmin POST hoadon → group ke-toan ⇒ 201 AgentGrantWriteResponse, version v0+1, subject group ref, granted_by tadmin (DB = id) [H3b-R06, R08]", async () => {
    S.v0 = await versionOf(x.sql);
    S.a0 = (await stateOf(x.sql)).audit;
    S.m0 = n.mark();
    const res = await postGrant(x, "tadmin", G);
    S.t2xx = Date.now();
    expect(res.status).toBe(201);
    const p = AgentGrantWriteResponseSchema.parse(res.json);
    expect(p.hub_config_version).toBe(S.v0 + 1);
    expect(await versionOf(x.sql)).toBe(S.v0 + 1);
    expect(p.grant.subject).toMatchObject({
      type: "group",
      group: { id: GRP.keToan, key: "ke-toan" },
    });
    expect({ by: p.grant.granted_by, tenant: p.grant.tenant_id, agent: p.grant.agent.key }).toEqual(
      {
        by: "tadmin",
        tenant: T.acme,
        agent: "hoadon",
      },
    );
    const row = await grantRow(x.sql, T.acme, G);
    expect({ id: row?.id, by: row?.granted_by }).toEqual({ id: p.grant.id, by: USERS.tadmin.id });
    S.grant = p.grant;
  });

  it("HUB-FR-78 · A21 · (sau A20) đúng 1 hàng audit grant đủ trường (before null, after khoá agent/subject, entity_name) [H3b-R16 · plan-db §3]", async () => {
    const rows = await auditSince(x.sql, S.a0);
    expect(rows.length).toBe(1);
    const r = rows[0] ?? {};
    expect({
      action: r.action,
      entity: r.entity,
      entity_id: r.entity_id,
      tenant_id: r.tenant_id,
      actor_id: r.actor_id,
      actor_username: r.actor_username,
      actor_role: r.actor_role,
      hub_config_version: r.hub_config_version,
      before: r.before,
      after: r.after,
      summary: r.summary,
      entity_name: r.entity_name,
    }).toEqual({
      action: "grant",
      entity: "agent_grant",
      entity_id: S.grant?.id,
      tenant_id: T.acme,
      actor_id: USERS.tadmin.id,
      actor_username: "tadmin",
      actor_role: "tenant_admin",
      hub_config_version: S.v0 + 1,
      before: null,
      after: {
        agent_id: AGT.hoadon,
        agent_key: "hoadon",
        subject_type: "group",
        subject_id: GRP.keToan,
        subject_key: "ke-toan",
      },
      summary: {},
      entity_name: "hoadon → ke-toan",
    });
  });

  it("HUB-FR-78 · A22 · (A20) đúng 1 NOTIFY {v, version: v0+1} ≤ 1 s (nới 3 s) sau 2xx [H3b-R08, R09]", async () => {
    await n.sentinel();
    expect(n.since(S.m0)).toEqual([{ v: HUB_CONTRACT_VERSION, version: S.v0 + 1 }]);
    const ms = (n.at(S.m0)[0] ?? Number.POSITIVE_INFINITY) - S.t2xx;
    console.log(`[A22] NOTIFY sau 2xx: ${ms} ms`);
    expect(ms).toBeLessThanOrEqual(3_000);
  });

  it("HUB-FR-78 · A23 · POST lại y hệt ⇒ 200 cùng id, granted_by/granted_at hàng gốc (G13), version hiện tại; 0 bump/audit/NOTIFY [H3b-R06]", async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const res = await postGrant(x, "padmin", G, T.acme);
    expect(res.status).toBe(200);
    const p = AgentGrantWriteResponseSchema.parse(res.json);
    expect({ id: p.grant.id, by: p.grant.granted_by, at: p.grant.granted_at }).toEqual({
      id: S.grant?.id ?? "",
      by: "tadmin",
      at: S.grant?.granted_at ?? "",
    });
    expect(p.hub_config_version).toBe(s0.version);
    await expectNoWrite(x.sql, n, m, s0);
  });

  it("HUB-FR-78 · A24 · POST hoadon → user hoa ⇒ 201, subject {type: user, user {id, username, display_name}} [H3b-R05 · U5]", async () => {
    const res = await postGrant(x, "tadmin", gr(AGT.hoadon, "user", USERS.hoa.id));
    expect(res.status).toBe(201);
    expect(AgentGrantWriteResponseSchema.parse(res.json).grant.subject).toEqual({
      type: "user",
      user: { id: USERS.hoa.id, username: "hoa", display_name: "hoa" },
    });
  });

  it("HUB-FR-78 · A25 · POST → user nghi (inactive) · agent tatt (tắt) · cli-x (runtime không chạy được) ⇒ 201 cả ba [H3b-R05]", async () => {
    const got = [];
    for (const g of [
      gr(AGT.hoadon, "user", USERS.nghi.id),
      gr(AGT.tatt, "group", GRP.keToan),
      gr(AGT.cliX, "group", GRP.keToan),
    ])
      got.push((await postGrant(x, "tadmin", g)).status);
    expect(got).toEqual([201, 201, 201]);
  });
});

/** Ca lỗi R04: [người gọi, grant, tenant query, kỳ vọng]. */
type Bad = [Who, GrantRef, string | undefined, ReturnType<typeof e>];
const agentRef = e(400, "INVALID_REFERENCE", { field: "agent_id" });
const subjRef = e(400, "INVALID_REFERENCE", { field: "subject_id" });
const notGrantable = e(409, "AGENT_NOT_GRANTABLE");
const notEnt = (id: string) => e(409, "NOT_ENTITLED", { agent_ids: [id] });
async function expectBad(cases: Bad[]): Promise<void> {
  const s0 = await stateOf(x.sql);
  const m = n.mark();
  const got = [];
  for (const [w, g, t] of cases) got.push(errOf(await postGrant(x, w, g, t)));
  expect(got).toEqual(cases.map((c) => c[3]));
  await expectNoWrite(x.sql, n, m, s0);
}

describe("A26–A33 · thứ tự lỗi R04, 0 ghi [HUB-BR-17 · H3b-R04 · HUB-H3b-AC-02, AC-03]", () => {
  it("HUB-BR-17 · A26 · agent_id không có (subject hợp lệ · subject beta) ⇒ 400 INVALID_REFERENCE {agent_id}; 0 ghi [H3b-R04]", async () => {
    await expectBad([
      ["tadmin", gr(NONE, "group", GRP.keToan), undefined, agentRef],
      ["tadmin", gr(NONE, "group", GRP.banHang), undefined, agentRef],
    ]);
  });

  it("HUB-BR-17 · A27 · Orchestrator mặc định · tenant acme · tenant beta (đều có ent. acme) ⇒ 409 AGENT_NOT_GRANTABLE không details; 0 ghi [H3b-R04 · HUB-H3b-AC-02]", async () => {
    await expectBad(
      [AGT.orch, AGT.orchAcme, AGT.orchBeta].map((a) => [
        "tadmin",
        gr(a, "group", GRP.keToan),
        undefined,
        notGrantable,
      ]),
    );
  });

  it("HUB-BR-17 · A28 · chua (không ent.) · cu (thu hồi) — tadmin và padmin ?tenant_id=acme · khodu (ent. chỉ beta) ⇒ 409 NOT_ENTITLED {agent_ids:[id]}; 0 ghi [H3b-R04 · HUB-H3b-AC-02]", async () => {
    const c: Bad[] = [];
    for (const a of [AGT.chua, AGT.cu]) {
      c.push(["tadmin", gr(a, "group", GRP.keToan), undefined, notEnt(a)]);
      c.push(["padmin", gr(a, "group", GRP.keToan), T.acme, notEnt(a)]);
    }
    c.push(["tadmin", gr(AGT.khodu, "group", GRP.keToan), undefined, notEnt(AGT.khodu)]);
    await expectBad(c);
  });

  it("HUB-BR-17 · A29 · Orchestrator không ent. acme ⇒ 409 AGENT_NOT_GRANTABLE (Orchestrator trước NOT_ENTITLED) [H3b-R04]", async () => {
    await revokeEnt(x.sql, AGT.orchBeta, T.acme);
    try {
      await expectBad([["tadmin", gr(AGT.orchBeta, "group", GRP.keToan), undefined, notGrantable]]);
    } finally {
      await entitle(x.sql, AGT.orchBeta, T.acme);
    }
  });

  it("HUB-BR-17 · A30 · subject group ban-hang · user an · không có · id user lan với subject_type group ⇒ 400 INVALID_REFERENCE {subject_id}, 4 thân ≡ nhau; 0 ghi [H3b-R03, R04 · HUB-H3b-AC-03]", async () => {
    await expectBad([
      ["tadmin", gr(AGT.hoadon, "group", GRP.banHang), undefined, subjRef],
      ["tadmin", gr(AGT.hoadon, "user", USERS.an.id), undefined, subjRef],
      ["tadmin", gr(AGT.hoadon, "user", NONE), undefined, subjRef],
      ["tadmin", gr(AGT.hoadon, "group", USERS.lan.id), undefined, subjRef],
    ]);
    const bodies = [];
    for (const s of [GRP.banHang, NONE])
      bodies.push((await postGrant(x, "tadmin", gr(AGT.hoadon, "group", s))).json);
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it("HUB-BR-17 · A31 · chua + subject beta ⇒ 409 NOT_ENTITLED (agent trước subject) [H3b-R04]", async () => {
    await expectBad([["tadmin", gr(AGT.chua, "group", GRP.banHang), undefined, notEnt(AGT.chua)]]);
  });

  it('HUB-FR-78 · A32 · thiếu agent_id · subject_type role · subject_id "x" · JSON hỏng ⇒ 400 VALIDATION_ERROR [H3b-R04 · AC-04]', async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const t = await tok(x.k, "tadmin");
    const bodies = [
      JSON.stringify({ subject_type: "group", subject_id: GRP.keToan }),
      JSON.stringify({ agent_id: AGT.hoadon, subject_type: "role", subject_id: GRP.keToan }),
      JSON.stringify({ agent_id: AGT.hoadon, subject_type: "group", subject_id: "x" }),
      '{"agent_id": ',
    ];
    const got = [];
    for (const b of bodies) {
      const res = await fetch(`${x.hub.base}/agent-grants`, {
        method: "POST",
        headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: b,
      });
      const j = await res.json().catch(() => undefined);
      got.push([res.status, j?.error?.code]);
    }
    expect(got).toEqual(bodies.map(() => [400, "VALIDATION_ERROR"]));
    await expectNoWrite(x.sql, n, m, s0);
  });

  it("HUB-FR-78 · A33 · mọi ca A26–A31 chạy lại liền nhau ⇒ 0 ghi (bảng, version, audit, NOTIFY) [H3b-R04 · AC-04]", async () => {
    await expectBad([
      ["tadmin", gr(NONE, "group", GRP.banHang), undefined, agentRef],
      ["tadmin", gr(AGT.orch, "group", GRP.keToan), undefined, notGrantable],
      ["padmin", gr(AGT.cu, "group", GRP.keToan), T.acme, notEnt(AGT.cu)],
      ["tadmin", gr(AGT.hoadon, "user", USERS.an.id), undefined, subjRef],
      ["tadmin", gr(AGT.chua, "group", GRP.banHang), undefined, notEnt(AGT.chua)],
    ]);
  });
});

describe("A34–A37 · thu hồi [HUB-FR-78 · H3b-R07, R08, R16 · HUB-H3b-AC-04]", () => {
  it("HUB-FR-78 · A34 · DELETE grant A20 ⇒ 204 thân rỗng; hàng mất; v+1; audit revoke (before = after grant + granted_by/at, after null, entity_id cũ); 1 NOTIFY [H3b-R07, R08, R16]", async () => {
    await insertGrant(x.sql, T.acme, G, USERS.tadmin.id);
    const row0 = await grantRow(x.sql, T.acme, G);
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    const res = await delGrant(x, "tadmin", G);
    expect({ status: res.status, text: res.text }).toEqual({ status: 204, text: "" });
    expect(await grantRow(x.sql, T.acme, G)).toBeUndefined();
    expect(await versionOf(x.sql)).toBe(s0.version + 1);
    const rows = await auditSince(x.sql, s0.audit);
    expect(
      rows.map((r) => [r.action, r.entity, r.entity_id, r.after, r.hub_config_version]),
    ).toEqual([["revoke", "agent_grant", row0?.id, null, s0.version + 1]]);
    const before = rows[0]?.before ?? {};
    expect(before).toMatchObject({
      agent_id: AGT.hoadon,
      agent_key: "hoadon",
      subject_type: "group",
      subject_id: GRP.keToan,
      subject_key: "ke-toan",
    });
    expect(Object.keys(before).sort()).toEqual([
      "agent_id",
      "agent_key",
      "granted_at",
      "granted_by",
      "subject_id",
      "subject_key",
      "subject_type",
    ]);
    expect(new Date(before.granted_at).getTime()).toBe(new Date(row0?.granted_at).getTime());
    await n.sentinel();
    expect(n.since(m)).toEqual([{ v: HUB_CONTRACT_VERSION, version: s0.version + 1 }]);
  });

  it("HUB-FR-78 · A35 · DELETE lại (không có hàng) ⇒ 204; 0 ghi [H3b-R07]", async () => {
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    expect((await delGrant(x, "tadmin", G)).status).toBe(204);
    await expectNoWrite(x.sql, n, m, s0);
  });

  it("HUB-FR-78 · A36 · DELETE grant có sẵn của cu (ent. thu hồi) · của Orchestrator (chèn owner) ⇒ 204 + 1 bump/audit/NOTIFY mỗi cái [H3b-R07]", async () => {
    const list = [gr(AGT.cu, "group", GRP.keToan), gr(AGT.orch, "user", USERS.lan.id)];
    for (const g of list) await insertGrant(x.sql, T.acme, g);
    for (const g of list) {
      const s0 = await stateOf(x.sql);
      const m = n.mark();
      expect((await delGrant(x, "tadmin", g)).status).toBe(204);
      expect(await grantRow(x.sql, T.acme, g)).toBeUndefined();
      expect(await versionOf(x.sql)).toBe(s0.version + 1);
      expect((await auditSince(x.sql, s0.audit)).map((r) => r.action)).toEqual(["revoke"]);
      await n.sentinel();
      expect(n.since(m).length).toBe(1);
    }
  });

  it("HUB-FR-78 · A37 · DELETE thiếu subject_id · agent_id không uuid ⇒ 400 VALIDATION_ERROR [H3b-R07]", async () => {
    const t = await tok(x.k, "tadmin");
    const paths = [
      `/agent-grants?agent_id=${AGT.hoadon}&subject_type=group`,
      `/agent-grants?agent_id=abc&subject_type=group&subject_id=${GRP.keToan}`,
    ];
    const got = [];
    for (const p of paths) {
      const res = await fetch(`${x.hub.base}${p}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${t}` },
      });
      got.push([res.status, (await res.json().catch(() => undefined))?.error?.code]);
    }
    expect(got).toEqual([
      [400, "VALIDATION_ERROR"],
      [400, "VALIDATION_ERROR"],
    ]);
  });
});

describe("A38–A41 · audit lỗi ⇒ rollback; granted_by [HUB-FR-78 · H3b-R08, R16 · HUB-H3b-AC-04 · QP2]", () => {
  async function withFailHub(actions: string[], body: (hub: HubX) => Promise<void>): Promise<void> {
    const hub = await startHubH3b(x.k, {
      instanceId: "qc-hub-h3b-fail",
      hubAudit: failingAudit(actions),
    });
    try {
      await body(hub);
    } finally {
      await hub.stop();
    }
  }

  it("HUB-FR-78 · A38 · hubAudit lỗi ở grant, POST mới ⇒ 500 INTERNAL_ERROR; 0 hàng, version giữ, 0 audit, 0 NOTIFY; rồi Hub thường POST ⇒ 201 (không kẹt khoá) [H3b-R08 · G3 · PL10]", async () => {
    const g = gr(AGT.hoadon, "group", GRP.kho);
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    await withFailHub(["grant"], async (hub) => {
      expect(errOf(await postGrant(x, "tadmin", g, undefined, hub))).toEqual(
        e(500, "INTERNAL_ERROR"),
      );
    });
    await expectNoWrite(x.sql, n, m, s0);
    expect((await postGrant(x, "tadmin", g)).status).toBe(201);
  });

  it("HUB-FR-78 · A39 · hubAudit lỗi ở revoke, DELETE có hàng ⇒ 500; hàng còn; version giữ; 0 audit; 0 NOTIFY [H3b-R08 · PL10]", async () => {
    const g = gr(AGT.tatt, "user", USERS.tam.id);
    await insertGrant(x.sql, T.acme, g);
    const s0 = await stateOf(x.sql);
    const m = n.mark();
    await withFailHub(["revoke"], async (hub) => {
      expect(errOf(await delGrant(x, "tadmin", g, undefined, hub))).toEqual(
        e(500, "INTERNAL_ERROR"),
      );
    });
    expect(await grantRow(x.sql, T.acme, g)).toBeDefined();
    await expectNoWrite(x.sql, n, m, s0);
  });

  it('HUB-FR-78 · A40 · grant do padmin tạo; tadmin GET ⇒ granted_by = "padmin" (QP2) [H3b-R11]', async () => {
    const g = gr(AGT.cliX, "user", USERS.lan.id);
    expect((await postGrant(x, "padmin", g, T.acme)).status).toBe(201);
    const res = await listGrants(x, "tadmin");
    const p = AgentGrantListResponseSchema.parse(res.json);
    const row = p.items
      .find((i) => i.agent.id === AGT.cliX)
      ?.grants.find((r) => r.subject.type === "user" && r.subject.user.id === USERS.lan.id);
    expect(row?.granted_by).toBe("padmin");
  });

  it("HUB-FR-78 · A41 · grant từ seed (granted_by NULL) ⇒ GET và POST trùng trả granted_by null [H3b-R06, R11]", async () => {
    const g = gr(AGT.tatt, "user", USERS.hoa.id);
    await insertGrant(x.sql, T.acme, g, null);
    const res = await listGrants(x, "tadmin");
    expect(res.status).toBe(200);
    const p = AgentGrantListResponseSchema.parse(res.json);
    const row = p.items
      .find((i) => i.agent.id === AGT.tatt)
      ?.grants.find((r) => r.subject.type === "user" && r.subject.user.id === USERS.hoa.id);
    expect(row).toBeDefined();
    expect(row?.granted_by).toBeNull();
    const dup = await postGrant(x, "tadmin", g);
    expect(dup.status).toBe(200);
    expect(AgentGrantWriteResponseSchema.parse(dup.json).grant.granted_by).toBeNull();
  });
});
