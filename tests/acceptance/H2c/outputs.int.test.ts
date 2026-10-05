// WRK-FR-18 · H2c-R25 (vế Hub), R26 · HUB-H2c-AC-12 (vế Hub) · P15, P21 · PL6, PL10 · test-plan-int §2.10 A90–A99:
// `POST /internal/jobs/:job/outputs` (token job agent `running`, role `agent`; luật tải lên như `/attachments`: tên, loại, chữ ký
// nội dung, 20 MiB; ≤ 5 output mỗi lần claim; hạn mức tenant) → hàng `origin='output'`; run `finished` → gắn output vào tin trả
// lời (`DISTINCT ON (job_id, safe_name)` của lần claim hiện hành, ≤ 10 theo thứ tự job rồi tên); run `failed`/`cancelled` → không
// gắn. Job SQL (`fileJob`) cho endpoint; run thật + `ScriptRuntime` (XADD tay `job.result{outputs}`) cho R26; hàng output R26
// chèn SQL (`outputRow`, `created_at` sau `started_at`) để tách khỏi endpoint.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { JobOutputResponseSchema } from "@ai/contracts/hub-internal";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { call, type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { insertConv, runIdOf, send, testRedis } from "../H1/_hub";
import { type Job, ScriptRuntime } from "../H1/_runtime";
import { type Dify, startDify, WF } from "../H2a/_h2a";
import { insertSqlJob } from "../H2a/_runtime2";
import { captureLogs, settleRuns } from "../H2b/_h2b";
import {
  attRow,
  diskFiles,
  type HubC,
  KEY_RE,
  MAX,
  parts,
  sample,
  setupH2c,
  startHubH2c,
} from "./_h2c";
import {
  agentWithOutputs,
  type BinRes,
  endSqlRuns,
  fileJob,
  outputRow,
  postOutput,
  reclaim,
  requeue,
  UNAUTHORIZED,
} from "./_h2c2";

let sql: Sql;
let k: Keys;
let hub: HubC;
let dify: Dify;
let redis: Redis;
let rt: ScriptRuntime;
let token = "";

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2c({ catalogBaseUrl: dify.baseUrl });
  // A97: 3 delegate + 4 vòng Orchestrator > max_steps 5 của fixture H1 (đặt trước khi dựng hub)
  await sql`update hub.orchestrator_settings set max_steps = 10 where id = 1`;
  k = await makeKeys();
  hub = await startHubH2c(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
  token = await sign(k, USERS.lan);
}, 60_000);
afterEach(async () => {
  await endSqlRuns(sql);
  await settleRuns(hub, sql, k);
});
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

const md = (s: string) => new TextEncoder().encode(`# ${s}\n\nNội dung báo cáo.\n`);
const outputRows = async (jobId: string) =>
  (await sql`select id from hub.attachments where job_id = ${jobId}`).length;
const errOf = (r: BinRes) => ({ status: r.status, code: r.json?.error?.code });

type DirectRun = {
  s: Awaited<ReturnType<typeof send>>;
  runId: string;
  conv: string;
  flow: string;
  job: Job;
};
/** Run `direct` `@assistant …` của `lan` + job agent đã claim. */
async function direct(content = "@assistant viết báo cáo"): Promise<DirectRun> {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const s = await send(hub, token, conv, content);
  expect(s.status).toBe(200);
  const runId = runIdOf(s);
  const job = await rt.next(runId);
  return { s, runId, conv, flow: s.headers.get("x-flow-id") ?? "", job };
}
const outs = (r: { conv: string; flow: string }, jobId: string, names: string[]) =>
  Promise.all(
    names.map((name) =>
      outputRow(sql, { jobId, conv: r.conv, flow: r.flow, name, content: md(name), dir: hub.dir }),
    ),
  );
/** Tin assistant (E11) của flow. */
async function answerOf(conv: string, flow: string): Promise<Json> {
  const r = await call(hub, "GET", `/conversations/${conv}/messages?flow_id=${flow}`, { token });
  return ((r.json?.items ?? []) as Json[]).find((m) => m.role === "assistant");
}
const boundTo = async (ids: string[]): Promise<(string | null)[]> => {
  const rows = await sql<{ id: string; m: string | null }[]>`select id, message_id as m
    from hub.attachments where id = any(${sql.array(ids, 2950)})`;
  return ids.map((id) => rows.find((r) => r.id === id)?.m ?? null);
};

describe("A90–A94 · POST /internal/jobs/:job/outputs [H2c-R25 · P21 · PL10]", () => {
  it("WRK-FR-18 · A90 · job agent running + token: X-Filename report.md thân chữ → 201 {id} (JobOutputResponse); hàng origin='output', job_id, user_id = user run, conversation_id/flow_id = payload, message_id NULL; file <dir>/<tenant>/<id> [H2c-R25 · HUB-H2c-AC-12]", async () => {
    const j = await fileJob(sql, hub);
    const body = md("report");
    const r = await postOutput(hub, j.jobId, j.token, "report.md", body);
    expect(r.status).toBe(201);
    const p = JobOutputResponseSchema.safeParse(r.json);
    expect(p.success).toBe(true);
    const row = await attRow(sql, p.data?.id ?? "");
    expect(row).toMatchObject({
      origin: "output",
      job_id: j.jobId,
      user_id: USERS.lan.id,
      tenant_id: USERS.lan.tid,
      conversation_id: j.convId,
      flow_id: j.flowId,
      message_id: null,
      filename: "report.md",
      mime: "text/markdown",
      size: body.length,
    });
    const files = await diskFiles(hub.dir);
    expect(files).toContain(`${USERS.lan.tid}/${p.data?.id}`);
    expect(files.every((f) => KEY_RE.test(f))).toBe(true);
  });

  it("WRK-FR-18 · A91 · .exe → 415; .pdf thân chữ → 415; 20 MiB + 1 → 413; thiếu X-Filename → 400; thân rỗng → 400 (thân toErrorBody, no-store); 0 hàng, 0 .part [H2c-R25 · H2c-R03]", async () => {
    const j = await fileJob(sql, hub);
    const ok = await postOutput(hub, j.jobId, j.token, "ok.md", md("ok"));
    expect(ok.status).toBe(201);
    const cases: [string, BinRes, { status: number; code: string }][] = [
      [
        ".exe",
        await postOutput(hub, j.jobId, j.token, "x.exe", md("x")),
        { status: 415, code: "ATTACHMENT_TYPE_NOT_ALLOWED" },
      ],
      [
        ".pdf thân chữ",
        await postOutput(hub, j.jobId, j.token, "x.pdf", md("x")),
        { status: 415, code: "ATTACHMENT_TYPE_NOT_ALLOWED" },
      ],
      [
        "20 MiB + 1",
        await postOutput(hub, j.jobId, j.token, "big.md", sample.txt(MAX + 1)),
        { status: 413, code: "ATTACHMENT_TOO_LARGE" },
      ],
      [
        "thiếu X-Filename",
        await postOutput(hub, j.jobId, j.token, null, md("x")),
        { status: 400, code: "VALIDATION_ERROR" },
      ],
      [
        "thân rỗng",
        await postOutput(hub, j.jobId, j.token, "empty.md", new Uint8Array(0)),
        { status: 400, code: "VALIDATION_ERROR" },
      ],
    ];
    for (const [label, r, want] of cases) {
      expect({ label, ...errOf(r) }).toEqual({ label, ...want });
      expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    }
    expect(await outputRows(j.jobId)).toBe(1);
    expect(parts(await diskFiles(hub.dir))).toEqual([]);
  });

  it("WRK-FR-18 · A92 · 5 output → 201 × 5, thứ 6 → 409 ATTACHMENT_QUOTA_EXCEEDED; requeue (claim lại, started_at mới) → lại được 5; hạn mức tenant đầy → 409 [P21 · PL10 · H2c-R06]", async () => {
    const j = await fileJob(sql, hub);
    const got: number[] = [];
    for (let i = 1; i <= 6; i++)
      got.push((await postOutput(hub, j.jobId, j.token, `o${i}.md`, md(`o${i}`))).status);
    expect(got).toEqual([201, 201, 201, 201, 201, 409]);
    const sixth = await postOutput(hub, j.jobId, j.token, "o7.md", md("o7"));
    expect(errOf(sixth)).toEqual({ status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" });
    const fresh = await reclaim(sql, j.jobId);
    const again: number[] = [];
    for (let i = 1; i <= 6; i++)
      again.push((await postOutput(hub, j.jobId, fresh, `r${i}.md`, md(`r${i}`))).status);
    expect(again).toEqual([201, 201, 201, 201, 201, 409]);
    const full = await startHubH2c(k, { tenantMaxBytes: 1 });
    try {
      const f = await fileJob(sql, full);
      const r = await postOutput(full, f.jobId, f.token, "q.md", md("q"));
      expect(errOf(r)).toEqual({ status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" });
    } finally {
      await full.stop();
    }
  });

  it("WRK-FR-18 · A93 · token sai / job Orchestrator (role≠agent) / job đã xong / workflow.async → 401 một thân; 0 hàng [H2c-R25 · P16]", async () => {
    const live = await fileJob(sql, hub);
    const orch = await fileJob(sql, hub);
    await sql`update hub.jobs set payload = jsonb_set(payload, '{agent,role}', '"orchestrator"')
      where id = ${orch.jobId}`;
    const done = await fileJob(sql, hub, { status: "succeeded" });
    const w = await insertSqlJob(sql, () => crypto.randomUUID(), {
      type: "workflow.async",
      workflowId: WF.dich,
      workflowKey: "dich",
    });
    const cases: [string, BinRes][] = [
      ["token sai", await postOutput(hub, live.jobId, "sai", "a.md", md("a"))],
      ["không header", await postOutput(hub, live.jobId, null, "a.md", md("a"))],
      ["orchestrator", await postOutput(hub, orch.jobId, orch.token, "a.md", md("a"))],
      ["đã xong", await postOutput(hub, done.jobId, done.token, "a.md", md("a"))],
      ["workflow.async", await postOutput(hub, w.jobId, w.token, "a.md", md("a"))],
    ];
    for (const [label, r] of cases) {
      expect({ label, status: r.status, json: r.json }).toEqual({
        label,
        status: 401,
        json: UNAUTHORIZED,
      });
      expect(r.headers.get("www-authenticate") ?? "").toMatch(/^Bearer/);
    }
    for (const id of [live.jobId, orch.jobId, done.jobId, w.jobId])
      expect(await outputRows(id)).toBe(0);
    // đối chứng: job agent running đúng token → 201
    expect((await postOutput(hub, live.jobId, live.token, "a.md", md("a"))).status).toBe(201);
  });

  it("WRK-FR-18 · A94 · log attachment_uploaded{origin:'output', job_id, attachment_id}; không tên file (report), không token [H2c-R07 · HUB-NFR-04]", async () => {
    const j = await fileJob(sql, hub);
    const logs = captureLogs();
    let r: BinRes;
    try {
      r = await postOutput(hub, j.jobId, j.token, "report-a94.md", md("a94"));
    } finally {
      logs.restore();
    }
    expect(r.status).toBe(201);
    const up = logs.lines.filter((l) => l.rec.msg === "attachment_uploaded");
    expect(up.map((l) => [l.level, l.rec.origin, l.rec.job_id, l.rec.attachment_id])).toEqual([
      ["info", "output", j.jobId, r.json?.id],
    ]);
    const dump = JSON.stringify(logs.lines);
    expect(dump).not.toContain("report-a94");
    expect(dump).not.toContain(j.token);
  });
});

describe("A95–A99 · gắn output vào tin trả lời [H2c-R26 · P15 · PL6 · PL10]", () => {
  it("WRK-FR-18 · A95 · job.result (XADD tay) có outputs:[ids] → Hub chấp nhận (run.finished); thiếu outputs → như H2b [contract C2]", async () => {
    const a = await direct("@assistant A95 có outputs");
    const ids = await outs(a, a.job.id, ["a95.md"]);
    await agentWithOutputs(rt, sql, a.job, { status: "done", text: "Xong A95." }, ids);
    expect((await a.s.terminal(15_000))?.event).toBe("run.finished");
    a.s.close();
    const b = await direct("@assistant A95 không outputs");
    await rt.agent(b.job, { status: "done", text: "Xong A95 b." });
    expect((await b.s.terminal(15_000))?.event).toBe("run.finished");
    b.s.close();
  });

  it("WRK-FR-18 · A96 · run finished (2 output) → tin assistant E11 attachments = 2 ref sắp safe_name, available:true; /content (JWT chủ) đúng byte [H2c-R26 · HUB-H2c-AC-12]", async () => {
    const r = await direct("@assistant A96 hai file");
    const [z, a] = await outs(r, r.job.id, ["z-report.md", "a-summary.md"]);
    await agentWithOutputs(rt, sql, r.job, { status: "done", text: "Đã ghi 2 file." }, [
      z as string,
      a as string,
    ]);
    expect((await r.s.terminal(15_000))?.event).toBe("run.finished");
    r.s.close();
    const ans = await answerOf(r.conv, r.flow);
    expect((ans?.attachments ?? []).map((x: Json) => [x.id, x.filename, x.available])).toEqual([
      [a, "a-summary.md", true],
      [z, "z-report.md", true],
    ]);
    const c = await call(hub, "GET", `/attachments/${a}/content`, { token });
    expect(c.status).toBe(200);
    expect(c.text).toBe(new TextDecoder().decode(md("a-summary.md")));
  });

  it("WRK-FR-18 · A97 · 3 job agent (delegate × 3) × 4 output → gắn 10 đầu theo (thứ tự job, tên); 2 còn lại chưa gắn [H2c-R26 · T3]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const s = await send(hub, token, conv, "Làm ba việc A97");
    expect(s.status).toBe(200);
    const run = { conv, flow: s.headers.get("x-flow-id") ?? "" };
    const runId = runIdOf(s);
    const perJob: string[][] = [];
    for (let i = 1; i <= 3; i++) {
      const o = await rt.next(runId);
      await rt.decide(o, { decision: "delegate", agent: "assistant", task: `Việc ${i} A97` });
      const a = await rt.next(runId);
      const ids = await outs(run, a.id, ["o4.md", "o3.md", "o2.md", "o1.md"]);
      perJob.push([...ids].reverse());
      // delegate đầu `done` + stream ⇒ trả thẳng (H2b-R19) — dùng `partial` để Orchestrator chạy tiếp
      const r = { status: "partial", text: `Xong ${i}.`, missing: "việc kế" } as const;
      await agentWithOutputs(rt, sql, a, r, ids);
    }
    const last = await rt.next(runId);
    await rt.decide(last, { decision: "answer", text: "Xong ba việc A97." });
    expect((await s.terminal(20_000))?.event).toBe("run.finished");
    s.close();
    const [ans] = await sql<{ id: string }[]>`select answer_message_id as id from hub.runs
      where id = ${runId}`;
    const want = [...(perJob[0] ?? []), ...(perJob[1] ?? []), ...(perJob[2] ?? []).slice(0, 2)];
    const rest = (perJob[2] ?? []).slice(2);
    expect(await boundTo(want)).toEqual(want.map(() => ans?.id ?? "?"));
    expect(await boundTo(rest)).toEqual([null, null]);
  });

  it("WRK-FR-18 · A98 · cùng job: claim 1 đẩy report.md + old.md, requeue, claim 2 đẩy report.md → chỉ report.md lần 2 gắn; old.md và bản cũ chưa gắn [PL6 · PL10]", async () => {
    const r = await direct("@assistant A98 requeue");
    const [old1, oldMd] = await outs(r, r.job.id, ["report.md", "old.md"]);
    await requeue(sql, rt, r.job.id);
    await sql`update hub.attachments set created_at = created_at - interval '1 hour'
      where id = any(${sql.array([old1 as string, oldMd as string], 2950)})`;
    const job2 = await rt.next(r.runId);
    expect(job2.id).toBe(r.job.id);
    const [fresh] = await outs(r, job2.id, ["report.md"]);
    await agentWithOutputs(rt, sql, job2, { status: "done", text: "Xong A98." }, [fresh as string]);
    expect((await r.s.terminal(15_000))?.event).toBe("run.finished");
    r.s.close();
    const [ans] = await sql<{ id: string }[]>`select answer_message_id as id from hub.runs
      where id = ${r.runId}`;
    expect(await boundTo([fresh as string, old1 as string, oldMd as string])).toEqual([
      ans?.id ?? "?",
      null,
      null,
    ]);
  });

  it("WRK-FR-18 · A99 · run failed / cancelled sau khi job đẩy output → output không gắn (message_id NULL); đối chứng run finished → gắn [H2c-R26 · H2c-R27]", async () => {
    const f = await direct("@assistant A99 lỗi");
    const [fid] = await outs(f, f.job.id, ["f.md"]);
    await rt.fail(f.job, "UPSTREAM_ERROR", "lỗi thử A99");
    expect((await f.s.terminal(15_000))?.event).toBe("run.failed");
    f.s.close();
    const c = await direct("@assistant A99 huỷ");
    const [cid] = await outs(c, c.job.id, ["c.md"]);
    expect((await call(hub, "POST", `/runs/${c.runId}/cancel`, { token })).status).toBeLessThan(
      300,
    );
    await c.s.terminal(15_000);
    c.s.close();
    const ok = await direct("@assistant A99 đối chứng");
    const [oid] = await outs(ok, ok.job.id, ["ok.md"]);
    await agentWithOutputs(rt, sql, ok.job, { status: "done", text: "Xong." }, [oid as string]);
    expect((await ok.s.terminal(15_000))?.event).toBe("run.finished");
    ok.s.close();
    const [ans] = await sql<{ id: string }[]>`select answer_message_id as id from hub.runs
      where id = ${ok.runId}`;
    expect(await boundTo([fid as string, cid as string, oid as string])).toEqual([
      null,
      null,
      ans?.id ?? "?",
    ]);
  });
});
