// HUB-FR-79 · ADM-FR-37 · H3b-R12–R15 · HUB-H3b-AC-07 · test-plan-cases H3b §2.5 A65–A72: GET `/agent-grants/effective/:user_id`
// — tính trên ảnh cache (R12), reasons/missing đúng thứ tự, ≡ `GET /agents`, 404 user ngoài T, chỉ đọc (0 audit), cache
// cập nhật sau POST (F4), group vắng không 500.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type EffectiveAgent,
  type EffectiveAgentsResponse,
  EffectiveAgentsResponseSchema,
} from "@ai/contracts/hub-admin";
import { adminChange, type Res, waitFor } from "../H1/_fixtures";
import { hubConfigChange } from "../H1/_hub";
import { menuKeys } from "../H2b/_h2b";
import {
  AGT,
  type Ctx,
  clearGrants,
  effectiveOf,
  entitle,
  expectSame404,
  GRP,
  type GrantRef,
  NONE,
  postGrant,
  startH3b,
  stateOf,
  T,
  tok,
  USERS,
  versionOf,
  type Who,
} from "./_h3b";

let x: Ctx;
beforeAll(async () => {
  x = await startH3b();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

const g = (agent: string, type: "group" | "user", subject: string): GrantRef => ({
  agent,
  type,
  subject,
});
/** Đặt bộ grant `acme` (+ tenant khác) bằng owner + bump + NOTIFY; trả version. */
const setGrants = (list: [string, GrantRef][]) =>
  hubConfigChange(x.sql, async (tx) => {
    await tx`delete from hub.agent_grants`;
    for (const [t, r] of list)
      await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        values (${r.agent}, ${t}, ${r.type}, ${r.subject})`;
  });
const parse = (r: Res): EffectiveAgentsResponse | undefined => {
  const p = EffectiveAgentsResponseSchema.safeParse(r.json);
  return r.status === 200 && p.success ? p.data : undefined;
};
/** Effective sau khi cache đạt `v` (F4, ≤ 10 s). */
async function effAt(w: Who, userId: string, v: number, tenant?: string) {
  const r = await waitFor(
    () => effectiveOf(x, w, userId, tenant),
    (res) => (parse(res)?.hub_config_version ?? -1) >= v,
    10_000,
  );
  expect(r.status).toBe(200);
  const p = parse(r);
  expect(p?.hub_config_version ?? -1).toBeGreaterThanOrEqual(v);
  return p;
}
const agentOf = (p: EffectiveAgentsResponse | undefined, key: string): EffectiveAgent | undefined =>
  p?.agents.find((a) => a.agent.key === key);
const brief = (a: EffectiveAgent | undefined) =>
  a && {
    visible: a.visible,
    // CR-054: thêm reason `grant_tenant` (chỉ đổi kiểu, giá trị cũ giữ nguyên).
    reasons: a.reasons.map((r) =>
      r.code === "grant_group"
        ? `group:${r.group.key}`
        : r.code === "grant_user"
          ? "user"
          : "tenant",
    ),
    missing: a.missing,
  };

describe("A65–A67 · nội dung + đối chiếu menu [HUB-FR-79 · H3b-R12–R14 · HUB-H3b-AC-07]", () => {
  it("HUB-FR-79 · A65 · grant hoadon → ke-toan + → user lan; effective lan ⇒ hoadon visible, reasons [grant_user, grant_group{ke-toan}], missing [] [H3b-R13, R14 · G6]", async () => {
    const v = await setGrants([
      [T.acme, g(AGT.hoadon, "group", GRP.keToan)],
      [T.acme, g(AGT.hoadon, "user", USERS.lan.id)],
    ]);
    const p = await effAt("tadmin", USERS.lan.id, v);
    expect(p?.user).toEqual({ id: USERS.lan.id, tenant_id: T.acme });
    const a = agentOf(p, "hoadon");
    expect(a?.visible).toBe(true);
    expect(a?.missing).toEqual([]);
    expect(a?.reasons[0]).toEqual({ code: "grant_user" });
    expect(a?.reasons[1]).toMatchObject({
      code: "grant_group",
      group: { id: GRP.keToan, key: "ke-toan", is_beta: false },
    });
    expect(a?.reasons.length).toBe(2);
  });

  it("HUB-FR-79 · A66 · đại diện ma trận: tatt agent_disabled · cli-x runtime_unavailable · nghi user_inactive · khoa tenant_locked · gam (gamma tự khoá, N3) tenant_locked · cu no_entitlement · không grant no_grant [H3b-R14]", async () => {
    await entitle(x.sql, AGT.hoadon, T.gamma);
    const v = await setGrants([
      [T.acme, g(AGT.tatt, "group", GRP.keToan)],
      [T.acme, g(AGT.cliX, "group", GRP.keToan)],
      [T.acme, g(AGT.cu, "group", GRP.keToan)],
      [T.acme, g(AGT.hoadon, "user", USERS.nghi.id)],
      [T.acme, g(AGT.hoadon, "user", USERS.khoa.id)],
      [T.gamma, g(AGT.hoadon, "user", USERS.gam.id)],
    ]);
    const lan = await effAt("tadmin", USERS.lan.id, v);
    expect(brief(agentOf(lan, "tatt"))).toEqual({
      visible: false,
      reasons: ["group:ke-toan"],
      missing: ["agent_disabled"],
    });
    expect(brief(agentOf(lan, "cli-x"))).toEqual({
      visible: false,
      reasons: ["group:ke-toan"],
      missing: ["runtime_unavailable"],
    });
    expect(brief(agentOf(lan, "cu"))).toEqual({
      visible: false,
      reasons: ["group:ke-toan"],
      missing: ["no_entitlement"],
    });
    expect(brief(agentOf(lan, "hoadon"))).toEqual({
      visible: false,
      reasons: [],
      missing: ["no_grant"],
    });
    const nghi = await effAt("tadmin", USERS.nghi.id, v);
    expect(brief(agentOf(nghi, "hoadon"))).toEqual({
      visible: false,
      reasons: ["user"],
      missing: ["user_inactive"],
    });
    const khoa = await effAt("tadmin", USERS.khoa.id, v);
    expect(brief(agentOf(khoa, "hoadon"))).toEqual({
      visible: false,
      reasons: ["user"],
      missing: ["tenant_locked"],
    });
    try {
      await adminChange(
        x.sql,
        "tenant",
        T.gamma,
        (tx) => tx`update admin.tenants set active = false where id = ${T.gamma}`,
      );
      const gam = await waitFor(
        async () => parse(await effectiveOf(x, "padmin", USERS.gam.id, T.gamma)),
        (p) => agentOf(p, "hoadon")?.missing.includes("tenant_locked") === true,
        10_000,
      );
      expect(brief(agentOf(gam, "hoadon"))).toEqual({
        visible: false,
        reasons: ["user"],
        missing: ["tenant_locked"],
      });
    } finally {
      await adminChange(
        x.sql,
        "tenant",
        T.gamma,
        (tx) => tx`update admin.tenants set active = true where id = ${T.gamma}`,
      );
    }
  });

  it("HUB-FR-79 · A67 · cùng version: tập visible của effective lan ≡ tập key GET /agents của lan [H3b-R12]", async () => {
    const v = await setGrants([
      [T.acme, g(AGT.hoadon, "group", GRP.keToan)],
      [T.acme, g(AGT.tatt, "user", USERS.lan.id)],
      [T.acme, g(AGT.cu, "group", GRP.keToan)],
    ]);
    const p = await effAt("tadmin", USERS.lan.id, v);
    const menu = await waitFor(
      async () => menuKeys(x.hub, await tok(x.k, "lan")),
      (m) => m?.includes("hoadon") === true,
      10_000,
    );
    const visible = (p?.agents ?? []).filter((a) => a.visible).map((a) => a.agent.key);
    expect(visible).toEqual(["hoadon"]);
    expect(menu).toEqual(visible);
  });
});

describe("A68–A72 · 404, phạm vi, chỉ đọc, cache [HUB-FR-79 · H3b-R12, R13, R15 · HUB-BR-14]", () => {
  it('HUB-BR-14 · A68 · tadmin: user an · "abc" · không có; padmin ?tenant_id=beta user lan ⇒ 404 ×4 (≡ nhau); padmin ?tenant_id=acme user lan ⇒ 200 [H3b-R03, R15]', async () => {
    expect((await effectiveOf(x, "tadmin", USERS.lan.id)).status).toBe(200);
    const none = await effectiveOf(x, "tadmin", NONE);
    expectSame404(await effectiveOf(x, "tadmin", USERS.an.id), none);
    expectSame404(await effectiveOf(x, "tadmin", "abc"), none);
    expectSame404(await effectiveOf(x, "padmin", USERS.lan.id, T.beta), none);
    expect((await effectiveOf(x, "padmin", USERS.lan.id, T.acme)).status).toBe(200);
  });

  it("HUB-FR-79 · A69 · effective lan không có khodu, chua, Orchestrator (mặc định, orch-acme, orch-beta) [H3b-R13]", async () => {
    const v = await setGrants([
      [T.acme, g(AGT.chua, "user", USERS.lan.id)],
      [T.acme, g(AGT.orch, "user", USERS.lan.id)],
      [T.acme, g(AGT.orchAcme, "group", GRP.keToan)],
      [T.beta, g(AGT.khodu, "user", USERS.lan.id)],
    ]);
    const p = await effAt("tadmin", USERS.lan.id, v);
    const ks = (p?.agents ?? []).map((a) => a.agent.key);
    for (const bad of ["khodu", "orchestrator", "orch-acme", "orch-beta"])
      expect(ks).not.toContain(bad);
    expect(agentOf(p, "chua")?.missing).toEqual(["no_entitlement"]);
  });

  it("HUB-FR-79 · A70 · gọi effective ⇒ 0 audit, version không đổi (chỉ đọc) [H3b-R15]", async () => {
    const s0 = await stateOf(x.sql);
    const res = await effectiveOf(x, "padmin", USERS.lan.id, T.acme);
    expect(res.status).toBe(200);
    expect(await stateOf(x.sql)).toEqual(s0);
  });

  it("HUB-FR-79 · A71 · POST grant mới ⇒ ≤ 10 s effective có hub_config_version ≥ version POST + reason mới (F4) [H3b-R09, R12]", async () => {
    await clearGrants(x.sql);
    const post = await postGrant(x, "tadmin", g(AGT.hoadon, "user", USERS.lan.id));
    expect(post.status).toBe(201);
    const v = post.json?.hub_config_version ?? (await versionOf(x.sql));
    const t0 = Date.now();
    const p = await effAt("tadmin", USERS.lan.id, v);
    console.log(`[A71] effective thấy grant sau ${Date.now() - t0} ms`);
    expect(brief(agentOf(p, "hoadon"))).toEqual({ visible: true, reasons: ["user"], missing: [] });
  });

  it("HUB-FR-79 · A72 · owner xoá group ke-toan không NOTIFY ⇒ effective 200, reasons bỏ group vắng, không 500 [H3b-R13 · plan-db §4]", async () => {
    const v = await setGrants([
      [T.acme, g(AGT.hoadon, "group", GRP.keToan)],
      [T.acme, g(AGT.hoadon, "user", USERS.lan.id)],
    ]);
    await effAt("tadmin", USERS.lan.id, v);
    await x.sql`delete from admin.groups where id = ${GRP.keToan}`;
    const res = await effectiveOf(x, "tadmin", USERS.lan.id);
    expect(res.status).toBe(200);
    const a = agentOf(parse(res), "hoadon");
    expect(a?.reasons).toEqual([{ code: "grant_user" }]);
  });
});
