// HUB-FR-78 · HUB-FR-77 · HUB-BR-17 · AC-H4b2-04 · AC-H4b2-05 · AC-H4b2-06 · spec H4b2 §2, §3 C · plan D2, D3, §2.4, §3.5
// · test-plan H4b2 §3 E01–E11: Quyền agent (entitlement agent × tenant) — ma trận (chỉ ô chưa thu hồi, đếm grant theo loại,
// Orchestrator riêng `only_tenant_id`), ô (drawer: grant cả khi đã thu hồi), cấp/thu hồi qua `putEntitlement` (audit +
// bump + NOTIFY; idempotent; `affected_grants`), hiệu lực ≤ 5 s ở menu user, grant giữ lại khi thu hồi và tự có hiệu lực khi
// cấp lại, run đang chạy vẫn xong, `AGENT_IS_DEFAULT`, tenant_admin bị chặn + NOT_ENTITLED (HUB-BR-17).
// Đỏ trước code: route chưa mount ⇒ 404 ≠ kỳ vọng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { waitFor } from "../H1/_fixtures";
import { insertConv, runIdOf, send, testRedis } from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import { menuKeys } from "../H2b/_h2b";
import { effectiveOf, type GrantRef, idGen3, insertGrant, postGrant, tok } from "../H3b/_h3b";
import {
  AGT,
  auditMax,
  auditSince,
  type Ctx,
  errOf,
  GRP,
  hubConfigChange,
  type Json,
  NONE,
  pa,
  type Res,
  st,
  startH4b2,
  T,
  USERS,
  versionOf,
} from "./_h4b2";

let x: Ctx;
let redis: Redis;
let rt: ScriptRuntime;
beforeAll(async () => {
  x = await startH4b2();
  redis = await testRedis();
  rt = new ScriptRuntime(x.sql, redis);
}, 60_000);
afterAll(async () => {
  redis?.disconnect();
  await x?.stop();
});

const id = idGen3(4300);
const cell = (agent: string, tenant: string) => `/agent-entitlements/${agent}/${tenant}`;
const menu = async () => menuKeys(x.hub, await tok(x.k, "lan"));
/** Chờ menu `lan` thoả `ok` (≤ 10 s); trả ms (AC ≤ 5 s). */
async function menuUntil(ok: (m: string[] | null) => boolean): Promise<number> {
  const t0 = Date.now();
  const m = await waitFor(menu, ok, 10_000);
  expect(ok(m)).toBe(true);
  return Date.now() - t0;
}
async function entRow(agent: string, tenant: string): Promise<Json | undefined> {
  const [r] =
    await x.sql`select * from hub.agent_entitlements where agent_id = ${agent} and tenant_id = ${tenant}`;
  return r ? { ...r } : undefined;
}
const grantCount = async (agent: string, tenant: string) => {
  const [r] = await x.sql<{ n: number }[]>`select count(*)::int as n from hub.agent_grants
    where agent_id = ${agent} and tenant_id = ${tenant}`;
  return r?.n ?? -1;
};
async function entState(): Promise<Json> {
  const e =
    await x.sql`select agent_id, tenant_id, revoked_at from hub.agent_entitlements order by 1, 2`;
  return { e: e.map((r) => ({ ...r })), v: await versionOf(x.sql), a: await auditMax(x.sql) };
}
async function noWrite(f: () => Promise<Res>, status: number, code: string): Promise<Res> {
  const s0 = await entState();
  const r = await f();
  expect([r.status, errOf(r).code]).toEqual([status, code]);
  expect(await entState()).toEqual(s0);
  return r;
}
/** Hai grant hoadon × acme (group ke-toan + user lan) bằng owner + bump/NOTIFY. */
async function twoGrants(): Promise<void> {
  await hubConfigChange(x.sql, async (tx) => {
    await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id) values
      (${AGT.hoadon}, ${T.acme}, 'group', ${GRP.keToan}), (${AGT.hoadon}, ${T.acme}, 'user', ${USERS.lan.id})
      on conflict do nothing`;
  });
}

describe("E01–E02 · ma trận + ô [HUB-FR-78 · spec §3 C GET]", () => {
  it("HUB-FR-78 · E01 · GET ma trận: agents (enabled, is_orchestrator, only_tenant_id), tenants (active), cells chỉ entitlement chưa thu hồi + đếm grant theo loại; hub_config_version; truncated false", async () => {
    await twoGrants();
    const r = await pa(x, "GET", "/agent-entitlements");
    expect(r.status).toBe(200);
    const ag = (aid: string) => r.json.agents.find((a: Json) => a.id === aid);
    expect(ag(AGT.hoadon)).toMatchObject({
      key: "hoadon",
      enabled: true,
      is_orchestrator: false,
      only_tenant_id: null,
    });
    expect(ag(AGT.tatt)).toMatchObject({ enabled: false });
    expect(ag(AGT.orchAcme)).toMatchObject({ is_orchestrator: true, only_tenant_id: T.acme });
    expect(ag(AGT.orch)).toMatchObject({ is_orchestrator: true, only_tenant_id: null });
    const tn = (tid: string) => r.json.tenants.find((t: Json) => t.id === tid);
    expect(tn(T.acme)).toMatchObject({ key: "acme", name: "Acme Corp", active: true });
    expect(tn(T.zeta)).toMatchObject({ active: false });
    const c = (a: string, t: string) =>
      r.json.cells.find((q: Json) => q.agent_id === a && q.tenant_id === t);
    expect(c(AGT.hoadon, T.acme)).toMatchObject({
      grant_count: 2,
      grants: { group: 1, user: 1, tenant: 0 },
    });
    expect(typeof c(AGT.hoadon, T.acme)?.granted_at).toBe("string");
    expect(c(AGT.khodu, T.beta)).toMatchObject({ grant_count: 0 });
    expect(c(AGT.cu, T.acme)).toBeUndefined();
    expect(c(AGT.chua, T.acme)).toBeUndefined();
    expect(r.json).toMatchObject({ truncated: false, hub_config_version: await versionOf(x.sql) });
  });

  it("HUB-FR-78 · E02 · GET ô: đã cấp ⇒ entitled, grants {id, subject_type, subject{id}}; đã thu hồi (cu) ⇒ entitled false, revoked_at, grant VẪN hiện; agent/tenant lạ ⇒ 404", async () => {
    await twoGrants();
    const a = await pa(x, "GET", cell(AGT.hoadon, T.acme));
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({
      agent: { id: AGT.hoadon, key: "hoadon" },
      tenant: { id: T.acme, key: "acme" },
      entitled: true,
      revoked_at: null,
      grants_truncated: false,
    });
    const subj = (a.json.grants as Json[]).map((g) => [g.subject_type, g.subject?.id]).sort();
    expect(subj).toEqual(
      [
        ["group", GRP.keToan],
        ["user", USERS.lan.id],
      ].sort(),
    );
    await insertGrant(x.sql, T.acme, { agent: AGT.cu, type: "group", subject: GRP.kho });
    const b = await pa(x, "GET", cell(AGT.cu, T.acme));
    expect(b.json).toMatchObject({ entitled: false });
    expect(typeof b.json?.revoked_at).toBe("string");
    expect((b.json?.grants ?? []).map((g: Json) => g.subject?.id)).toEqual([GRP.kho]);
    expect((await pa(x, "GET", cell(NONE, T.acme))).status).toBe(404);
    expect((await pa(x, "GET", cell(AGT.hoadon, NONE))).status).toBe(404);
  });
});

describe("E03–E06 · cấp / thu hồi [AC-H4b2-04 · AC-H4b2-05 · HUB-FR-77 · plan D2]", () => {
  it("HUB-FR-78 · AC-H4b2-04 · E03 · trước: tadmin grant chua ⇒ NOT_ENTITLED; PUT chua×acme ⇒ 200 {v+1, affected_grants 0}, audit agent_entitlement enable; tadmin grant được; ≤ 5 s menu lan có chua", async () => {
    const g: GrantRef = { agent: AGT.chua, type: "user", subject: USERS.lan.id };
    expect(errOf(await postGrant(x, "tadmin", g)).code).toBe("NOT_ENTITLED");
    const v0 = await versionOf(x.sql);
    const m = await auditMax(x.sql);
    const r = await pa(x, "PUT", cell(AGT.chua, T.acme));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ hub_config_version: v0 + 1, affected_grants: 0 });
    expect((await entRow(AGT.chua, T.acme))?.revoked_at).toBeNull();
    const au = await auditSince(x.sql, m);
    expect(au.map((a) => [a.entity, a.action])).toEqual([["agent_entitlement", "enable"]]);
    expect((await postGrant(x, "tadmin", g)).status).toBe(201);
    const ms = await menuUntil((mm) => mm?.includes("chua") === true);
    console.log(`[E03] menu lan có chua sau ${ms} ms`);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  it("HUB-FR-78 · E04 · PUT lại (đã cấp) ⇒ 200 idempotent: không bump, không audit", async () => {
    expect((await pa(x, "PUT", cell(AGT.chua, T.acme))).status).toBe(200);
    const s0 = await entState();
    const r = await pa(x, "PUT", cell(AGT.chua, T.acme));
    expect(r.status).toBe(200);
    expect(r.json?.hub_config_version).toBe(s0.v);
    expect(await entState()).toEqual(s0);
  });

  it("HUB-FR-78 · AC-H4b2-05 · E05 · DELETE hoadon×acme có 2 grant ⇒ affected_grants 2, grant giữ nguyên, ≤ 5 s biến khỏi menu lan (effective: no_entitlement); PUT lại ⇒ grant tự có hiệu lực ≤ 5 s", async () => {
    await twoGrants();
    await menuUntil((mm) => mm?.includes("hoadon") === true);
    const m = await auditMax(x.sql);
    const d = await pa(x, "DELETE", cell(AGT.hoadon, T.acme));
    expect(d.status).toBe(200);
    expect(d.json?.affected_grants).toBe(2);
    expect(await grantCount(AGT.hoadon, T.acme)).toBe(2);
    expect(typeof (await entRow(AGT.hoadon, T.acme))?.revoked_at?.toISOString).toBe("function");
    expect((await auditSince(x.sql, m)).map((a) => a.action)).toEqual(["disable"]);
    const ms1 = await menuUntil((mm) => mm !== null && !mm.includes("hoadon"));
    expect(ms1).toBeLessThanOrEqual(5_000);
    const eff = await effectiveOf(x, "tadmin", USERS.lan.id);
    const h = (eff.json?.agents ?? []).find((a: Json) => a.agent?.key === "hoadon");
    expect(h?.missing ?? []).toContain("no_entitlement");
    const p = await pa(x, "PUT", cell(AGT.hoadon, T.acme));
    expect(p.json?.affected_grants).toBe(2);
    expect((await entRow(AGT.hoadon, T.acme))?.revoked_at).toBeNull();
    const ms2 = await menuUntil((mm) => mm?.includes("hoadon") === true);
    expect(ms2).toBeLessThanOrEqual(5_000);
    expect(await grantCount(AGT.hoadon, T.acme)).toBe(2);
  });

  it("HUB-FR-78 · AC-H4b2-05 · E06 · run đang chạy (job hoadon đã giao) lúc thu hồi ⇒ run vẫn xong (run.finished)", async () => {
    await twoGrants();
    await menuUntil((mm) => mm?.includes("hoadon") === true);
    const conv = await insertConv(x.sql, "lan", id());
    const sse = await send(x.hub, await tok(x.k, "lan"), conv, "Tổng hợp hoá đơn tháng 9");
    expect(sse.status).toBe(200);
    const runId = runIdOf(sse);
    try {
      const orch = await rt.next(runId, 10_000);
      await rt.decide(orch, { decision: "delegate", agent: "hoadon", task: "Tổng hợp hoá đơn" });
      const job = await rt.next(runId, 10_000);
      expect(job.payload.agent.key).toBe("hoadon");
      expect((await pa(x, "DELETE", cell(AGT.hoadon, T.acme))).status).toBe(200);
      await rt.agent(job, { status: "done", text: "12 hoá đơn." });
      const next = await rt.tryNext(runId, 1_500);
      if (next) await rt.decide(next, echoAnswer(next));
      const e = await sse.terminal(10_000);
      expect(e?.event).toBe("run.finished");
    } finally {
      sse.close();
      await pa(x, "PUT", cell(AGT.hoadon, T.acme));
    }
  });
});

describe("E07–E11 · lỗi + quyền [HUB-BR-17 · AC-H4b2-06 · spec §2 Quyền thao tác]", () => {
  it("HUB-FR-78 · E07 · DELETE agent mặc định của acme (hoadon) ⇒ 409 AGENT_IS_DEFAULT; 0 ghi", async () => {
    await hubConfigChange(x.sql, async (tx) => {
      await tx`insert into hub.tenant_agent_defaults (tenant_id, default_agent_id, fallback_agent_id, on_no_match)
        values (${T.acme}, ${AGT.hoadon}, null, 'answer')`;
    });
    try {
      await noWrite(() => pa(x, "DELETE", cell(AGT.hoadon, T.acme)), 409, "AGENT_IS_DEFAULT");
    } finally {
      await hubConfigChange(x.sql, async (tx) => {
        await tx`delete from hub.tenant_agent_defaults where tenant_id = ${T.acme}`;
      });
    }
  });

  it("HUB-FR-78 · E08 · agent lạ ⇒ 400 INVALID_REFERENCE{agent_id}; tenant lạ ⇒ 404; id không phải uuid ⇒ 400; 0 ghi", async () => {
    const r = await noWrite(() => pa(x, "PUT", cell(NONE, T.acme)), 400, "INVALID_REFERENCE");
    expect(errOf(r).details).toMatchObject({ field: "agent_id" });
    await noWrite(() => pa(x, "PUT", cell(AGT.chua, NONE)), 404, "NOT_FOUND");
    await noWrite(() => pa(x, "PUT", "/agent-entitlements/abc/def"), 400, "VALIDATION_ERROR");
  });

  it("HUB-BR-17 · AC-H4b2-06 · E09 · tadmin acme: GET ma trận / GET ô / PUT / DELETE ⇒ 403 (không thấy entitlement tenant khác); 0 ghi", async () => {
    for (const [m, p] of [
      ["GET", "/agent-entitlements"],
      ["GET", cell(AGT.khodu, T.beta)],
      ["PUT", cell(AGT.khodu, T.acme)],
      ["DELETE", cell(AGT.hoadon, T.acme)],
    ] as const)
      await noWrite(() => st(x, "tadmin", m, p), 403, "FORBIDDEN");
  });

  it("HUB-BR-17 · AC-H4b2-06 · E10 · padmin thu hồi qua Studio ⇒ tadmin cấp grant agent đó ⇒ 409 NOT_ENTITLED {agent_ids}", async () => {
    expect((await pa(x, "DELETE", cell(AGT.cliX, T.acme))).status).toBe(200);
    try {
      const r = await postGrant(x, "tadmin", { agent: AGT.cliX, type: "group", subject: GRP.kho });
      expect([r.status, errOf(r).code]).toEqual([409, "NOT_ENTITLED"]);
      expect(errOf(r).details).toMatchObject({ agent_ids: [AGT.cliX] });
    } finally {
      await pa(x, "PUT", cell(AGT.cliX, T.acme));
    }
  });

  it("HUB-FR-78 · E11 · lan (member), badmin ⇒ 403; không token ⇒ 401", async () => {
    for (const w of ["lan", "badmin"] as const)
      expect(errOf(await st(x, w, "GET", "/agent-entitlements")).status).toBe(403);
    expect((await st(x, null, "GET", "/agent-entitlements")).status).toBe(401);
  });
});
