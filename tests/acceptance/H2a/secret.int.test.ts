// HUB-H2a-AC-04 · HUB-BR-06 · AC-H05 · H2a-R17 · Q5 · P1, P2 · test-plan H2a §5 + cases §6 A80–A86, A83b: secret không rò
// (SSE, JSON, DB, Redis, log) qua mọi đường gọi Dify; credential endpoint cho Runtime (`workflow.async` running, 401 đồng
// nhất, 409 secret hỏng, không xét `workflows.enabled`); quyền DB hàm SECURITY DEFINER; token job chỉ lưu hash.
// A84/A85 là ca DB thuần (D2 đã có) — có thể xanh trước code hub-api (test-plan §8, chấp nhận, ghi §10).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DifyCredentialResponseSchema, ErrorResponseSchema } from "@ai/contracts/hub-internal";
import postgres from "postgres";
import { setSink } from "../../../apps/hub-api/src/lib/logger";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  HUB_API_URL,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  T,
  USERS,
} from "../H1/_fixtures";
import {
  AG,
  type HubX,
  insertConv,
  insertHubConfig,
  runIdOf,
  type Sse,
  send,
  testRedis,
} from "../H1/_hub";
import { echoAnswer, type Job } from "../H1/_runtime";
import {
  ARGS_DICH,
  catalogChange,
  corruptSecret,
  type Dify,
  dumpRun,
  INTERNAL_TOKEN,
  idGen2,
  insertCatalog,
  insertH2aAgents,
  LEAK_DICH,
  LEAK_ECHO,
  LEAK_INVOICE,
  leakForms,
  MAP_DICH,
  OUT,
  secretIdOf,
  setAppKey,
  startDify,
  startHubH2a,
  stored,
  WF,
  WF_KEY,
} from "./_h2a";
import { credential, insertSqlJob, mcp, newJobToken, ScriptRuntime2 } from "./_runtime2";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt2: ScriptRuntime2;
let dify: Dify;
const id = idGen2(4000);
const lines: string[] = [];
let restore: () => void = () => {};

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl, extras: true });
  await insertH2aAgents(sql);
  k = await makeKeys();
  restore = setSink((_level, line) => lines.push(line));
  hub = await startHubH2a(k);
  redis = await testRedis();
  rt2 = new ScriptRuntime2(sql, redis);
}, 60_000);
afterAll(async () => {
  restore();
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

const tokLan = () => sign(k, USERS.lan);
async function open(content: string): Promise<Sse> {
  const conv = await insertConv(sql, "lan", id());
  return send(hub, await tokLan(), conv, content);
}
async function finish(s: Sse, ms = 8_000): Promise<Sse> {
  try {
    if (s.status === 200) await s.terminal(ms);
  } finally {
    s.close();
  }
  return s;
}
const streamDump = async (runId: string): Promise<string> =>
  JSON.stringify([
    await redis.xrange(`run:${runId}`, "-", "+"),
    await redis.xrange(`sse:${runId}`, "-", "+"),
  ]);
const SECRETS = [LEAK_DICH, LEAK_INVOICE, LEAK_ECHO];

describe("A80 · secret không rò qua mọi đường gọi Dify [HUB-H2a-AC-04 · H2a-R17]", () => {
  it("A80 · sync, async + credential, MCP, dify-*, test-run, lỗi có key trong thân → 0 dạng key (thô/base64/hex) trong SSE, JSON, DB, Redis, log [HUB-H2a-AC-04]", async () => {
    await setAppKey(sql, "dich", LEAK_DICH);
    // agent dify-tom (workflow `tom`) cũng mang key rò rỉ để bước dify-* có nghĩa khi quét
    await setAppKey(sql, "tom", LEAK_DICH);
    dify.mock.reset();
    const from = lines.length;
    const blobs: string[] = [];
    const runIds: string[] = [];
    // 1. sync
    const s1 = await finish(await open("/dich en xin"));
    runIds.push(runIdOf(s1));
    blobs.push(JSON.stringify(s1.events), JSON.stringify(s1.json ?? null));
    // 2. async + credential (response credential là kênh hợp lệ duy nhất mang key → không quét)
    const s2 = await open("/dich-async en xin");
    try {
      runIds.push(runIdOf(s2));
      const a = await rt2.claimAsync(runIdOf(s2));
      const cred = await credential(hub, a.job.id, a.token);
      expect(cred.status).toBe(200);
      expect(cred.json?.api_key).toBe(LEAK_DICH);
      await rt2.rt.text(a.job, "Kết quả async không chứa khoá.");
      await s2.terminal(8_000);
    } finally {
      s2.close();
    }
    blobs.push(JSON.stringify(s2.events));
    // 3. MCP tools/call (check-invoice, secret LEAK_INVOICE)
    const mj = await insertSqlJob(sql, id, {
      type: "agent.cli",
      agentId: AG.hoadon,
      agentKey: "hoadon",
      tools: [WF_KEY.checkInvoice],
      mcpUrl: `${hub.base}/mcp`,
    });
    await redis.del(`run:${mj.runId}`, `sse:${mj.runId}`); // TC-B6-1: id cố định, xoá stream sót lần trước
    runIds.push(mj.runId);
    const mres = await mcp(hub, mj.token, "tools/call", {
      name: WF_KEY.checkInvoice,
      arguments: { x: `HD-001 ${LEAK_INVOICE}`, y: "ghi chú" },
    });
    expect(mres.status).toBe(200);
    blobs.push(mres.text);
    // 4. dify-* (Orchestrator delegate tới dify-tom, rồi trả lời)
    const s4 = await open("Dịch giúp tôi câu này");
    try {
      runIds.push(runIdOf(s4));
      let turn = 0;
      await rt2.rt.serve(
        runIdOf(s4),
        async (job: Job) => {
          turn++;
          if (turn === 1)
            await rt2.rt.decide(job, {
              decision: "delegate",
              agent: "dify-tom",
              task: "xin chào",
            });
          else await rt2.rt.decide(job, echoAnswer(job));
        },
        12_000,
      );
      await s4.terminal(3_000);
    } finally {
      s4.close();
    }
    blobs.push(JSON.stringify(s4.events));
    // 5. test-run
    const tr = await call(hub, "POST", "/internal/test-run", {
      headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
      body: {
        command: {
          workflow_id: WF.dich,
          args: ARGS_DICH,
          input_map: MAP_DICH,
          output: OUT,
          timeout_s: 10,
        },
        text: "en xin",
        actor_user_id: USERS.padmin.id,
      },
    });
    expect(tr.status).toBe(200);
    blobs.push(tr.text);
    // 6. lỗi Dify có key trong thân
    await setAppKey(sql, "dich", LEAK_ECHO);
    const s6 = await finish(await open("/dich en xin"));
    runIds.push(runIdOf(s6));
    blobs.push(JSON.stringify(s6.events));
    // MK đã thật sự nhận key (để phép quét có nghĩa)
    const auths = dify.runs().map((c) => c.auth);
    expect(auths).toContain(`Bearer ${LEAK_DICH}`);
    expect(auths).toContain(`Bearer ${LEAK_INVOICE}`);
    expect(dify.echoCount()).toBeGreaterThanOrEqual(1);
    for (const r of runIds.filter(Boolean)) blobs.push(await dumpRun(sql, r), await streamDump(r));
    blobs.push(lines.slice(from).join("\n"));
    const all = blobs.join("\n");
    for (const sec of SECRETS)
      for (const f of leakForms(sec))
        expect({ f, hit: all.includes(f) }).toEqual({ f, hit: false });
    await setAppKey(sql, "dich", "mk-ok");
    await setAppKey(sql, "tom", "mk-ok");
  });
});

describe("A81–A83b · credential cho Runtime (Q5) [H2a-R17]", () => {
  it("A81 · token job workflow.async running → 200 {base_url, api_key, app_type} + Cache-Control no-store; log không có Authorization/key/token [H2a-R17]", async () => {
    await setAppKey(sql, "dich", "mk-ok");
    const j = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
    });
    const from = lines.length;
    const res = await credential(hub, j.jobId, j.token);
    expect(res.status).toBe(200);
    expect(DifyCredentialResponseSchema.safeParse(res.json).data).toEqual({
      base_url: dify.baseUrl,
      api_key: stored("mk-ok"),
      app_type: "workflow",
    });
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
    for (const l of lines.slice(from)) {
      expect(l).not.toContain(stored("mk-ok"));
      expect(l).not.toContain(j.token);
      expect(l.toLowerCase()).not.toContain("bearer");
    }
  });

  it("A82 · 401 cùng body: không token, token sai, token job khác, job không running (succeeded/queued), job agent.cli [Q5]", async () => {
    const A = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
    });
    const B = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
    });
    const done = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
      status: "succeeded",
    });
    const queued = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
      status: "queued",
    });
    const cli = await insertSqlJob(sql, id, {
      type: "agent.cli",
      agentId: AG.hoadon,
      agentKey: "hoadon",
    });
    const cases: [string, string, string | undefined][] = [
      ["không token", A.jobId, undefined],
      ["token sai", A.jobId, newJobToken()],
      ["token job khác", A.jobId, B.token],
      ["job succeeded", done.jobId, done.token],
      ["job queued", queued.jobId, queued.token],
      ["job agent.cli", cli.jobId, cli.token],
    ];
    const got = [];
    for (const [name, jobId, token] of cases) {
      const r = await credential(hub, jobId, token);
      got.push({ name, status: r.status, body: r.text });
    }
    const first = got[0];
    expect(first?.status).toBe(401);
    expect(ErrorResponseSchema.safeParse(JSON.parse(first?.body || "null")).data?.error.code).toBe(
      "UNAUTHORIZED",
    );
    for (const g of got)
      expect({ name: g.name, status: g.status, body: g.body }).toEqual({
        ...first,
        name: g.name,
      } as Json);
  });

  it("A83 · secret hỏng / key_version lệch → 409 NOT_CONFIGURED; workflow tắt (tat) vẫn 200 — credential không xét workflows.enabled [Q5 · H2a-R08]", async () => {
    try {
      await corruptSecret(sql, "tom");
      const j1 = await insertSqlJob(sql, id, {
        type: "workflow.async",
        workflowId: WF.tom,
        workflowKey: "tom",
      });
      const r1 = await credential(hub, j1.jobId, j1.token);
      expect(r1.status).toBe(409);
      expect(ErrorResponseSchema.safeParse(r1.json).data?.error.code).toBe("NOT_CONFIGURED");
      await setAppKey(sql, "tom", "mk-ok");
      await sql`update admin.secrets set key_version = 2 where id = ${secretIdOf("tom")}`;
      const r2 = await credential(hub, j1.jobId, j1.token);
      expect(r2.status).toBe(409);
      expect(r2.text).toBe(r1.text);
    } finally {
      await setAppKey(sql, "tom", "mk-ok");
    }
    const jt = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.tat,
      workflowKey: "tat",
    });
    const rt = await credential(hub, jt.jobId, jt.token);
    expect(rt.status).toBe(200);
    expect(rt.json?.api_key).toBe(stored("mk-ok"));
  });

  it("A83b · async: job queued, tắt workflow (Admin) trước claim → claim + credential 200 → run vẫn run.finished [HUB-BR-06 · AC-H05]", async () => {
    await setAppKey(sql, "dich", "mk-ok");
    const s = await open("/dich-async en xin");
    try {
      expect(s.status).toBe(200);
      const runId = runIdOf(s);
      expect(await rt2.peekAsync(runId)).toBeDefined();
      await catalogChange(
        sql,
        (tx) => tx`update admin.workflows set enabled = false where id = ${WF.dich}`,
      );
      await Bun.sleep(500);
      const a = await rt2.claimAsync(runId);
      const cred = await credential(hub, a.job.id, a.token);
      expect(cred.status).toBe(200);
      await rt2.rt.text(a.job, "Kết quả sau khi workflow bị tắt.");
      const end = await s.terminal(8_000);
      expect(end?.event).toBe("run.finished");
      expect(end?.data?.content).toBe("Kết quả sau khi workflow bị tắt.");
    } finally {
      s.close();
      await catalogChange(
        sql,
        (tx) => tx`update admin.workflows set enabled = true where id = ${WF.dich}`,
      );
    }
  });
});

const sqlState = (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code,
  );
/** Chạy `fn` dưới `SET LOCAL ROLE role` (owner), luôn rollback; trả kết quả hoặc mã lỗi. */
async function asRole<V>(
  role: string,
  fn: (tx: postgres.TransactionSql) => Promise<V>,
): Promise<V | string> {
  let out: V | string = "∅";
  await sql
    .begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      out = await fn(tx).catch((e: { code?: string }) => e.code ?? String(e));
      throw new Error("rollback");
    })
    .catch(() => {});
  return out;
}

describe("A84–A86 · quyền DB secret/usage, token chỉ lưu hash [P1 · P2 · H2a-R17]", () => {
  it("A84 · sau 0002/0003: hub_ro không SELECT admin.secrets (42501); workflow_secret(wf) đúng 1 secret của workflow, uuid lạ 0 dòng; hub_rw/agent_runtime không EXECUTE [P1 · khoá M2]", async () => {
    const [p] = await sql<
      Json[]
    >`select has_table_privilege('hub_ro', 'admin.secrets', 'SELECT') as t,
      has_any_column_privilege('hub_ro', 'admin.secrets', 'SELECT') as c,
      has_function_privilege('hub_rw', 'hub.workflow_secret(uuid)', 'EXECUTE') as rw,
      has_function_privilege('agent_runtime', 'hub.workflow_secret(uuid)', 'EXECUTE') as rt`;
    expect(p).toEqual({ t: false, c: false, rw: false, rt: false });
    expect(await asRole("hub_ro", (tx) => tx`select id from admin.secrets`)).toBe("42501");
    const one = await asRole(
      "hub_ro",
      (tx) => tx`select secret_id from hub.workflow_secret(${WF.dich})`,
    );
    expect(one).toEqual([{ secret_id: secretIdOf("dich") }] as never);
    const other = await asRole(
      "hub_ro",
      (tx) => tx`select secret_id from hub.workflow_secret(${WF.hoi})`,
    );
    expect(other).toEqual([{ secret_id: secretIdOf("hoi") }] as never);
    const none = await asRole("hub_ro", (tx) => tx`select * from hub.workflow_secret(${T.zeta})`);
    expect(none).toEqual([] as never);
  });

  it("A85 · hub_api vẫn không INSERT/UPDATE usage_logs (khoá H1 A51); log_dify_usage cố định billing/provider dify, model NULL [P2]", async () => {
    const [p] = await sql<
      Json[]
    >`select has_table_privilege('hub_api', 'hub.usage_logs', 'INSERT') as ins,
      has_table_privilege('hub_api', 'hub.usage_logs', 'UPDATE') as upd`;
    expect(p).toEqual({ ins: false, upd: false });
    const api = postgres(HUB_API_URL, { max: 1, onnotice: () => {} });
    try {
      expect(
        await sqlState(
          api`insert into hub.usage_logs (tenant_id, billing) values (${T.acme}, 'dify')`,
        ),
      ).toBe("42501");
      const run = id();
      await api`select hub.log_dify_usage(${T.acme}, ${run}, ${id()}, ${USERS.lan.id}, ${null}, ${null},
        ${20}, ${0}, ${"0.0001"}, ${12})`;
      const [u] = await sql<
        Json[]
      >`select billing, provider_key, model from hub.usage_logs where run_id = ${run}`;
      expect(u).toEqual({ billing: "dify", provider_key: "dify", model: null });
    } finally {
      await api.end();
    }
  });

  it("A86 · token job không có trong DB/log sau khi Hub dùng nó; token_hash 32 byte; jobs_token_hash_uq chặn trùng [H2a-R17]", async () => {
    const from = lines.length;
    const A = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
    });
    const B = await insertSqlJob(sql, id, {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
    });
    const res = await credential(hub, A.jobId, A.token);
    expect(res.status).toBe(200);
    const [len] = await sql<{ n: number }[]>`select octet_length(token_hash)::int as n from hub.jobs
      where id = ${A.jobId}`;
    expect(len?.n).toBe(32);
    const dump = JSON.stringify([
      ...(await sql`select * from hub.jobs where id in (${A.jobId}, ${B.jobId})`),
      ...(await sql`select * from hub.run_steps where run_id in (${A.runId}, ${B.runId})`),
    ]);
    const logs = lines.slice(from).join("\n");
    for (const f of leakForms(A.token)) {
      expect(dump).not.toContain(f);
      expect(logs).not.toContain(f);
    }
    const dup = sql`update hub.jobs set token_hash = (select token_hash from hub.jobs where id = ${A.jobId})
      where id = ${B.jobId}`;
    const err = await dup.then(
      () => null,
      (e: { code?: string; constraint_name?: string }) => e,
    );
    expect({ code: err?.code, c: err?.constraint_name }).toEqual({
      code: "23505",
      c: "jobs_token_hash_uq",
    });
  });
});
