// HUB-FR-62 · HUB-FR-69 · HUB-FR-03 · HUB-BR-06 · H4a-AC-08 (vế run), AC-09 · H4a-R10 · test-plan H4a §3 A63–A66: sửa
// qua Studio ⇒ NOTIFY ⇒ run MỚI dùng bản mới ≤ 5 s (nới 10 s khi chờ, in ms); run đang chạy giữ snapshot. Orchestrator
// tenant tạo qua API: run của user acme dùng bản tenant, tenant khác dùng mặc định (CR-032). Runtime giả `ScriptRuntime`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type UserKey, waitFor } from "../H1/_fixtures";
import { insertConv, ORCH_PROMPT, runIdOf, runRow, type Sse, send, testRedis } from "../H1/_hub";
import { type Job, ScriptRuntime } from "../H1/_runtime";
import { settleRuns } from "../H2b/_h2b";
import {
  AG,
  AG4,
  type Ctx,
  cliBody,
  idGen4,
  orchBody,
  PROFILE,
  pa,
  putOf,
  startH4a,
  T,
  tok,
} from "./_h4a";

let x: Ctx;
let redis: Redis;
let rt: ScriptRuntime;
beforeAll(async () => {
  x = await startH4a({ instanceId: "qc-hub-h4a-prop" });
  redis = await testRedis();
  rt = new ScriptRuntime(x.sql, redis);
}, 60_000);
afterEach(async () => {
  await settleRuns(x.hub, x.sql, x.k);
});
afterAll(async () => {
  redis?.disconnect();
  await x?.stop();
});

const id = idGen4(6000);
type Run = { s: Sse; runId: string };
async function start(who: UserKey & ("lan" | "an" | "gam"), content: string): Promise<Run> {
  const conv = await insertConv(x.sql, who, id());
  const s = await send(x.hub, await tok(x.k, who as never), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}
/** Run thăm dò: job Orchestrator đầu tiên (key + payload) rồi huỷ run. */
async function probe(
  who: "lan" | "an" | "gam",
): Promise<{ key: string; text: string; runId: string }> {
  const r = await start(who, "Dò Orchestrator H4a");
  const job = await rt.next(r.runId);
  r.s.close();
  await call(x.hub, "POST", `/runs/${r.runId}/cancel`, { token: await tok(x.k, who as never) });
  return { key: job.payload.agent.key, text: JSON.stringify(job.payload), runId: r.runId };
}
async function within(
  who: "lan" | "an" | "gam",
  ok: (p: { key: string; text: string }) => boolean,
) {
  const t0 = Date.now();
  const p = await waitFor(() => probe(who), ok, 10_000);
  return { p, ms: Date.now() - t0 };
}

describe("A63–A64 · Orchestrator tenant qua API vào run [HUB-FR-62 · H4a-AC-08 · CR-032]", () => {
  it("HUB-FR-62 · A63 · POST Orchestrator acme = tu-do ⇒ run mới của lan (acme) dùng tu-do ≤ 5 s, runs.orchestrator_tenant_id = acme [H4a-AC-08 · H4a-R10]", async () => {
    const r = await pa(x, "POST", "/orchestrator/tenants", {
      ...orchBody(AG4.free),
      tenant_id: T.acme,
    });
    expect(r.status).toBe(201);
    const { p, ms } = await within("lan", (q) => q.key === "tu-do");
    console.info(`A63 lan thấy Orchestrator tenant sau ${ms} ms`);
    expect(p.key).toBe("tu-do");
    expect(ms).toBeLessThanOrEqual(5_000);
    expect((await runRow(x.sql, p.runId))?.orchestrator_tenant_id).toBe(T.acme);
  });

  it("HUB-FR-62 · A64 · tenant khác: gam (gamma, không bản riêng) ⇒ mặc định `orchestrator`; an (beta) ⇒ orch-beta4 [H4a-AC-08 · CR-032]", async () => {
    const g = await probe("gam");
    expect(g.key).toBe("orchestrator");
    expect((await runRow(x.sql, g.runId))?.orchestrator_tenant_id).toBeNull();
    expect((await probe("an")).key).toBe("orch-beta4");
  });
});

describe("A65–A66 · sửa agent lan tới run mới, run cũ giữ snapshot [HUB-FR-69 · H4a-AC-09 · HUB-BR-06]", () => {
  const NEW_PROMPT = "QC-H4A-PROMPT-MOI: điều phối theo bản Studio.";

  it("HUB-FR-69 · A65 · run gam đang chạy (job 1 prompt cũ) → PUT system_prompt Orchestrator mặc định qua Studio → run mới ≤ 5 s có prompt mới; job kế của run cũ vẫn prompt cũ [H4a-AC-09 · BR-06]", async () => {
    const old = await start("gam", "Run giữ snapshot H4a");
    const first: Job = await rt.next(old.runId);
    expect(JSON.stringify(first.payload)).toContain(ORCH_PROMPT);

    const cur = await pa(x, "GET", `/agents/${AG.orchestrator}`);
    expect(cur.status).toBe(200);
    const body = putOf(
      cliBody("orchestrator", {
        system_prompt: NEW_PROMPT,
        name: cur.json.name,
        description: cur.json.description,
      }),
      cur.json.version,
    );
    const u = await pa(x, "PUT", `/agents/${AG.orchestrator}`, body);
    expect(u.status).toBe(200);

    const { p, ms } = await within("gam", (q) => q.text.includes(NEW_PROMPT));
    console.info(`A65 run mới thấy prompt mới sau ${ms} ms`);
    expect(ms).toBeLessThanOrEqual(5_000);
    expect(p.text).not.toContain(ORCH_PROMPT);

    await rt.decide(first, { decision: "delegate", agent: "hoadon", task: "Tra" });
    const second: Job = await rt.next(old.runId, 10_000);
    expect(second.payload.agent.key).toBe("orchestrator");
    expect(JSON.stringify(second.payload)).toContain(ORCH_PROMPT);
    expect(JSON.stringify(second.payload)).not.toContain(NEW_PROMPT);
    old.s.close();
  });

  it("HUB-FR-69 · A66 · đổi profile agent `assistant` sang claude-sub-1 qua Studio ⇒ GET /agents/:id phản ánh ngay; hub_config_version /me = DB [H4a-AC-09 · H4a-R02]", async () => {
    const cur = await pa(x, "GET", `/agents/${AG.assistant}`);
    expect(cur.status).toBe(200);
    const body = putOf(
      cliBody("assistant", {
        name: cur.json.name,
        description: cur.json.description,
        profile_id: PROFILE.claude,
      }),
      cur.json.version,
    );
    const u = await pa(x, "PUT", `/agents/${AG.assistant}`, {
      ...body,
      system_prompt: "Trợ lý mới H4a.",
    });
    expect(u.status).toBe(200);
    expect((await pa(x, "GET", `/agents/${AG.assistant}`)).json.profile_id).toBe(PROFILE.claude);
    const me = await waitFor(
      () => pa(x, "GET", "/me"),
      (r) => r.json?.hub_config_version === u.json.hub_config_version,
      5_000,
    );
    expect(me.json.hub_config_version).toBe(u.json.hub_config_version);
  });
});
