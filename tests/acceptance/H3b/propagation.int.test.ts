// HUB-FR-78 · AC-H09 · AC-A11 · H3b-R09, R10 · test-plan-cases H3b §2.6 A80–A86: grant/thu hồi qua API lan tới instance Hub
// khác ≤ 5 s (LISTEN thật, nới 10 s, in ms) cho `GET /agents` + danh sách agent trong prompt Orchestrator; run đang chạy
// giữ version cũ (HUB-BR-06); thu hồi entitlement ⇒ mất agent nhưng grant còn, cấp lại ⇒ về đúng grant cũ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  AgentGrantListResponseSchema,
  EffectiveAgentsResponseSchema,
} from "@ai/contracts/hub-admin";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { waitFor } from "../H1/_fixtures";
import { block, type HubX, insertConv, runIdOf, runRow, send, testRedis } from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import { menuKeys } from "../H2b/_h2b";
import {
  AGT,
  type Ctx,
  delGrant,
  effectiveOf,
  entitle,
  errOf,
  GRP,
  type GrantRef,
  grantRow,
  idGen3,
  listGrants,
  postGrant,
  revokeEnt,
  startH3b,
  startHubH3b,
  T,
  tok,
  USERS,
  versionOf,
} from "./_h3b";

let x: Ctx;
let hub2: HubX;
let redis: Redis;
let rt: ScriptRuntime;
beforeAll(async () => {
  x = await startH3b({ instanceId: "qc-hub-h3b-1" });
  hub2 = await startHubH3b(x.k, { instanceId: "qc-hub-h3b-2" });
  redis = await testRedis();
  rt = new ScriptRuntime(x.sql, redis);
}, 60_000);
afterAll(async () => {
  await hub2?.stop();
  redis?.disconnect();
  await x?.stop();
});

const id = idGen3(3000);
const G: GrantRef = { agent: AGT.hoadon, type: "group", subject: GRP.keToan };
const menu = async (hub: HubX) => menuKeys(hub, await tok(x.k, "lan"));
/** Chờ menu `lan` ở `hub` thoả `ok` (≤ 10 s, AC ≤ 5 s); trả menu + ms. */
async function menuUntil(hub: HubX, ok: (m: string[] | null) => boolean) {
  const t0 = Date.now();
  const m = await waitFor(() => menu(hub), ok, 10_000);
  return { m, ms: Date.now() - t0 };
}
/** Một lượt gửi của `lan` trên `hub`: lấy khối `<agents>` của prompt Orchestrator rồi trả lời echo để run kết thúc. */
async function orchAgents(hub: HubX): Promise<string> {
  const conv = await insertConv(x.sql, "lan", id());
  const s = await send(hub, await tok(x.k, "lan"), conv, "Kiểm tra danh sách agent");
  expect(s.status).toBe(200);
  const job = await rt.next(runIdOf(s), 10_000);
  const agents = block(job.payload.prompt, "agents") ?? "";
  await rt.decide(job, echoAnswer(job));
  await s.terminal(10_000);
  s.close();
  return agents;
}

describe("A80–A83 · grant/thu hồi lan sang instance 2 [HUB-FR-78 · AC-H09 · H3b-R09]", () => {
  it("AC-H09 · A80 · trước grant: lan ở cả 2 instance GET /agents không hoadon; prompt Orchestrator instance 2 không hoadon [H3b-R09]", async () => {
    for (const h of [x.hub, hub2]) {
      const m = await menu(h);
      expect(m).not.toBeNull();
      expect(m ?? []).not.toContain("hoadon");
    }
    expect(await orchAgents(hub2)).not.toContain("hoadon");
  });

  it("AC-H09 · A81 · tadmin POST trên instance 1 ⇒ ≤ 5 s (nới 10 s) instance 2 GET /agents có hoadon; lượt gửi kế có hoadon [H3b-R09 · HUB-H3b-AC-04]", async () => {
    expect((await postGrant(x, "tadmin", G)).status).toBe(201);
    const r = await menuUntil(hub2, (m) => m?.includes("hoadon") === true);
    console.log(`[A81] instance 2 thấy hoadon sau ${r.ms} ms`);
    expect(r.m).toContain("hoadon");
    expect(r.ms).toBeLessThanOrEqual(10_000);
    expect(await orchAgents(hub2)).toContain("hoadon");
  });

  it("AC-H09 · A82 · run đang chạy lúc grant ⇒ runs.config_version của run = version cũ (HUB-BR-06) [H3b-R09]", async () => {
    const conv = await insertConv(x.sql, "lan", id());
    const s = await send(hub2, await tok(x.k, "lan"), conv, "Run giữ ảnh cũ");
    expect(s.status).toBe(200);
    const runId = runIdOf(s);
    const job = await rt.next(runId, 10_000);
    const old = (await runRow(x.sql, runId))?.config_version;
    try {
      const g: GrantRef = { agent: AGT.tatt, type: "group", subject: GRP.keToan };
      expect((await postGrant(x, "tadmin", g)).status).toBe(201);
      expect(await versionOf(x.sql)).toBeGreaterThan(old);
      expect((await runRow(x.sql, runId))?.config_version).toBe(old);
    } finally {
      await rt.decide(job, echoAnswer(job));
      await s.terminal(10_000);
      s.close();
    }
  });

  it("AC-H09 · A83 · DELETE ⇒ ≤ 5 s hoadon biến khỏi cả 2 instance [H3b-R07, R09]", async () => {
    expect((await delGrant(x, "tadmin", G)).status).toBe(204);
    for (const [name, h] of [
      ["1", x.hub],
      ["2", hub2],
    ] as const) {
      const r = await menuUntil(h, (m) => m !== null && !m.includes("hoadon"));
      console.log(`[A83] instance ${name} mất hoadon sau ${r.ms} ms`);
      expect(r.m).not.toBeNull();
      expect(r.m ?? []).not.toContain("hoadon");
    }
  });
});

describe("A84–A86 · thu hồi / cấp lại entitlement [HUB-FR-78 · AC-A11 · H3b-R10]", () => {
  it("AC-A11 · A84 · thu hồi ent. hoadon/acme ⇒ ≤ 5 s mất khỏi GET /agents; grant còn; effective missing [no_entitlement], reasons [grant_group ke-toan]; GET /agent-grants không còn hoadon [H3b-R10]", async () => {
    expect((await postGrant(x, "tadmin", G)).status).toBe(201);
    expect((await menuUntil(hub2, (m) => m?.includes("hoadon") === true)).m).toContain("hoadon");
    const before = await grantRow(x.sql, T.acme, G);
    const v = await revokeEnt(x.sql, AGT.hoadon, T.acme);
    const r = await menuUntil(hub2, (m) => m !== null && !m.includes("hoadon"));
    console.log(`[A84] mất hoadon sau ${r.ms} ms`);
    expect(r.m ?? ["?"]).not.toContain("hoadon");
    expect((await grantRow(x.sql, T.acme, G))?.id).toBe(before?.id);
    const eff = await waitFor(
      async () =>
        EffectiveAgentsResponseSchema.safeParse(
          (await effectiveOf(x, "tadmin", USERS.lan.id)).json,
        ),
      (p) => p.success && p.data.hub_config_version >= v,
      10_000,
    );
    const a = eff.success ? eff.data.agents.find((i) => i.agent.key === "hoadon") : undefined;
    expect(a?.missing).toEqual(["no_entitlement"]);
    expect(a?.reasons.map((i) => (i.code === "grant_group" ? i.group.key : i.code))).toEqual([
      "ke-toan",
    ]);
    const list = await listGrants(x, "tadmin");
    expect(list.status).toBe(200);
    expect(
      AgentGrantListResponseSchema.parse(list.json).items.map((i) => i.agent.key),
    ).not.toContain("hoadon");
  });

  it("AC-A11 · A86 · POST khi đang thu hồi ⇒ 409 NOT_ENTITLED [H3b-R04, R10]", async () => {
    const g: GrantRef = { agent: AGT.hoadon, type: "group", subject: GRP.kho };
    expect(errOf(await postGrant(x, "tadmin", g))).toEqual({
      status: 409,
      code: "NOT_ENTITLED",
      details: { agent_ids: [AGT.hoadon] },
    });
  });

  it("AC-A11 · A85 · cấp lại ent. ⇒ ≤ 5 s hoadon trở lại, cùng grant.id, không POST [H3b-R10]", async () => {
    const before = await grantRow(x.sql, T.acme, G);
    expect(before).toBeDefined();
    await entitle(x.sql, AGT.hoadon, T.acme);
    const r = await menuUntil(hub2, (m) => m?.includes("hoadon") === true);
    console.log(`[A85] hoadon trở lại sau ${r.ms} ms`);
    expect(r.m).toContain("hoadon");
    expect((await grantRow(x.sql, T.acme, G))?.id).toBe(before?.id);
  });
});
