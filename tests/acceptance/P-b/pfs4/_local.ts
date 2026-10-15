// P-b · PF-S4 · AC-PB-03 · AC-PB-04 · PB-R17 · PB-R18 · helper riêng thư mục pfs4 (không chứa `it(...)`).
// Dựng Hub in-process với kho file local (cần cho `GET /internal/jobs/:id/attachments/:attId` thật) + Runtime giả
// `ScriptRuntime`, seed P-a PF1 (agent m1–m3/lead, qc-team/pm-team/lead-team) + 4 def PB-S4 (stage 0 agent → stage 1 nhóm/agent).
// Mọi jsonb qua `sql.json`, mảng uuid qua `sql.array(…, 2950)` (CONVENTIONS §2 bẫy).
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_SHA256_HEADER } from "@ai/contracts/hub-internal";
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import type { AttachmentStorage } from "../../../../apps/hub-api/src/modules/attachments/storage";
import { createLocalStorage } from "../../../../apps/hub-api/src/modules/attachments/storage.local";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { type Job, ScriptRuntime } from "../../H1/_runtime";
import { newJobToken, tokenHash } from "../../H2a/_runtime2";
import {
  api,
  type CtxPa,
  type Json,
  PA,
  PA_FIX,
  type Role,
  type Sql,
  setupPa,
  stageDef,
  T,
  waitFor,
} from "../../P-a/_support/pa";
import {
  insertDefPf1,
  jobDone,
  P1,
  runRow,
  seedPf1,
  startInRoom,
  TEAM_TEMPLATE,
} from "../../P-a/pf1/_local";

export {
  MD_AUTO,
  MD_OK,
  nextStageJob,
  openTask,
  outputs,
  review,
  stageRow,
  waitStatus,
} from "../../P-a/pf1/_local";
export {
  type Job,
  type Json,
  jobDone,
  P1,
  PA,
  PA_FIX,
  runRow,
  type Sql,
  startInRoom,
  T,
  TEAM_TEMPLATE,
  waitFor,
};

const x = (n: number) => `b4b40000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Def PF-S4 (acme). Stage 0 = agent `hd-read` (output O0 `s0-v1-hoa-don.md`), stage 1 = nhóm / agent. */
export const D4 = {
  seq: { id: x(1), key: "pb4-seq", team: P1.teamQc },
  pm: { id: x(2), key: "pb4-pm", team: P1.teamPm },
  lead: { id: x(3), key: "pb4-lead", team: P1.teamLead },
} as const;
export const IDS_DEF = { id: x(4), key: "pb4-ids" } as const;
export const SINGLE_DEF = { id: x(5), key: "pb4-single" } as const;

const PM_TEMPLATE = "## Phần A\n\n## Phần B\n";
const stage0 = (after: Json = { kind: "auto" }): Json =>
  stageDef({ key: "doc", executor: { kind: "agent", agent_id: P1.agRead }, after });
const teamStage = (teamId: string, template: string, sections: string[]): Json =>
  stageDef({
    key: "nhom",
    name: "Soạn tài liệu",
    executor: { kind: "team", team_id: teamId },
    output: { filename: "tai-lieu.md", template, required_sections: sections, fields: [] },
    after: { kind: "review", group_id: PA_FIX.gKeToan },
  });

async function seedPfs4(sql: Sql): Promise<void> {
  const abc = ["Phần A", "Phần B", "Phần C"];
  const defs: [{ id: string; key: string }, Json[]][] = [
    [D4.seq, [stage0(), teamStage(P1.teamQc, TEAM_TEMPLATE, abc)]],
    [D4.pm, [stage0(), teamStage(P1.teamPm, PM_TEMPLATE, abc.slice(0, 2))]],
    [D4.lead, [stage0(), teamStage(P1.teamLead, TEAM_TEMPLATE, abc)]],
    [
      IDS_DEF,
      [
        stage0({ kind: "review", group_id: PA_FIX.gKeToan }),
        stageDef({
          key: "s1",
          name: "Bước 2",
          executor: { kind: "agent", agent_id: P1.agRead },
          after: { kind: "auto" },
        }),
      ],
    ],
    [
      SINGLE_DEF,
      [
        stageDef({
          key: "s1",
          executor: { kind: "agent", agent_id: P1.agRead },
          after: { kind: "auto" },
        }),
      ],
    ],
  ];
  for (const [d, stages] of defs) await insertDefPf1(sql, { ...d, name: d.key, stages });
}

export type Ctx4 = CtxPa & { dir: string };

/** Unhandled rejection bắt được trong tiến trình test (TM-11). */
export const rejections: unknown[] = [];
const onRejection = (e: unknown) => {
  rejections.push(e);
};

export async function startPfs4(o: { storage?: AttachmentStorage } = {}): Promise<Ctx4> {
  process.on("unhandledRejection", onRejection);
  const { sql, ready } = await setupPa();
  if (ready) {
    await seedPf1(sql);
    await seedPfs4(sql);
  }
  const k = await makeKeys();
  const dir = await mkdtemp(join(tmpdir(), "pb-pfs4-"));
  const storage = o.storage ?? (await createLocalStorage({ dir })); // FB1: o.storage = driver FileBox
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: "qc-pfs4-1",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 4,
    processEngine: true,
    processLoops: false,
    attachments: { storage, tenantMaxBytes: 1_073_741_824, sweepS: 600, sweep: false },
  } as unknown as HubDeps & Record<string, unknown>;
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const rtRedis = await testRedis();
  const base = `http://localhost:${server.port}`;
  const tok = (r: Role) => sign(k, PA[r]);
  const c: Ctx4 = {
    sql,
    ready,
    k,
    hub: { base, db, redis, instanceId: "qc-pfs4-1", handles: () => null, kicks: [] } as never,
    redis: rtRedis,
    rt: new ScriptRuntime(sql, rtRedis),
    tok,
    call: async (r, method, path, body) => api(c.hub, await tok(r), method, path, body),
    dir,
    stop: async () => {
      process.off("unhandledRejection", onRejection);
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      rtRedis.disconnect();
      await db.close();
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    },
  };
  return c;
}

// ---------- member nội dung ----------
const SEC: Record<string, string> = {
  [P1.agM1]: "Phần A",
  [P1.agM2]: "Phần B",
  [P1.agM3]: "Phần C",
};
const KEY: Record<string, string> = { [P1.agM1]: "m1", [P1.agM2]: "m2", [P1.agM3]: "m3" };
export const memberKey = (j: Job): string => KEY[j.payload.agent.id] ?? j.payload.agent.id;
/** Thành viên trả đúng mục mình, có dấu `Nội dung <key> v1`. */
export const ownMd = (j: Job): string =>
  `## ${SEC[j.payload.agent.id]}\nNội dung ${memberKey(j)} v1.`;

// ---------- tải file nội bộ bằng token job ----------
export type Probe = {
  id: string;
  name: string;
  status: number;
  text: string;
  headerSha: string | null;
  payloadSha: string;
};
export const sha256 = (t: string): string => createHash("sha256").update(t, "utf8").digest("hex");

/** Đặt token cho job (như Runtime lúc claim) rồi tải MỌI file trong `payload.attachments` như member thật. */
export async function probeJob(c: Ctx4, j: Job): Promise<Probe[]> {
  const token = newJobToken();
  await c.sql`update hub.jobs set token_hash = ${tokenHash(token)} where id = ${j.id}`;
  const atts = (j.payload.attachments ?? []) as { id: string; name: string; sha256: string }[];
  const out: Probe[] = [];
  for (const a of atts) {
    const r = await getAtt(c, j.id, a.id, token);
    out.push({
      id: a.id,
      name: a.name,
      status: r.status,
      text: r.text,
      headerSha: r.headerSha,
      payloadSha: a.sha256,
    });
  }
  return out;
}
export async function getAtt(
  c: Ctx4,
  jobId: string,
  attId: string,
  token: string,
): Promise<{ status: number; text: string; headerSha: string | null; json: Json }> {
  const res = await fetch(`${c.hub.base}/internal/jobs/${jobId}/attachments/${attId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, headerSha: res.headers.get(CONTENT_SHA256_HEADER), json };
}
/** Token mới cho job (đã claim ⇒ `running`). */
export async function tokenFor(c: Ctx4, j: Job): Promise<string> {
  const token = newJobToken();
  await c.sql`update hub.jobs set token_hash = ${tokenHash(token)} where id = ${j.id}`;
  return token;
}

// ---------- phục vụ job của process run ----------
export async function serve(
  c: Ctx4,
  runId: string,
  handler: (j: Job, i: number) => Promise<void>,
  ms = 12_000,
): Promise<Job[]> {
  const end = Date.now() + ms;
  const jobs: Job[] = [];
  while (Date.now() < end) {
    if ((await runRow(c.sql, runId))?.status !== "running") break;
    const q = await waitFor(
      async () =>
        (
          await c.sql<
            { run_id: string }[]
          >`select j.run_id from hub.jobs j join hub.runs r on r.id = j.run_id
            where r.process_run_id = ${runId} and j.status = 'queued' order by j.created_at limit 1`
        )[0],
      (v) => v !== undefined,
      300,
    );
    if (!q) continue;
    const j = await c.rt.tryNext(q.run_id, 300);
    if (!j) continue;
    jobs.push(j);
    await handler(j, jobs.length - 1);
  }
  return jobs;
}

/** Stage 0 (hd-read) xong tức thì; stage ≥ 1 do `onTeam`. Trả toàn bộ job đã nhận. */
export async function serveAll(
  c: Ctx4,
  runId: string,
  onTeam: (j: Job, i: number) => Promise<void>,
): Promise<Job[]> {
  return serve(c, runId, async (j, i) => {
    if (j.payload.agent.id === P1.agRead)
      await jobDone(c, j, "## Bảng ý\nHD-12.\n\n## Số tiền\n12 000 000");
    else await onTeam(j, i);
  });
}

// ---------- đọc DB ----------
export const hubRunOf = async (sql: Sql, id: string): Promise<Json> =>
  (await sql<Json[]>`select * from hub.runs where id = ${id}`)[0];
export const stageHubRuns = (sql: Sql, processRunId: string) =>
  sql<
    Json[]
  >`select * from hub.runs where process_run_id = ${processRunId} order by started_at, id`;
export const ERROR_CODES_7 = [
  "ALL_PROVIDERS_EXHAUSTED",
  "TIMEOUT",
  "UPSTREAM_ERROR",
  "CANCELLED",
  "BUDGET_EXCEEDED",
  "NOT_CONFIGURED",
  "INTERNAL_ERROR",
];
/** Bất biến `runs_error_code_ck` mức ứng dụng: số run vi phạm (TM-10). */
export async function badRuns(sql: Sql): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.runs
    where ((error_code is not null) <> (status in ('failed','cancelled')))
       or (error_code is not null and error_code <> all(${sql.array(ERROR_CODES_7)}))`;
  return r?.n ?? -1;
}
/** Chờ process run không còn hub.runs `running` (không kẹt). */
export async function stuckRunning(sql: Sql, processRunId: string, ms = 10_000): Promise<number> {
  const n = await waitFor(
    async () =>
      (
        await sql<{ n: number }[]>`select count(*)::int as n from hub.runs
          where process_run_id = ${processRunId} and status = 'running'`
      )[0]?.n ?? -1,
    (v) => v === 0,
    ms,
  );
  return n as number;
}
/** Dọn: hủy run quy trình đang mở, kết thúc job/run còn lại (giữ giới hạn đồng thời cho ca sau). */
export async function settleAll(sql: Sql): Promise<void> {
  await sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
  await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
  await sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
}
export const names = (ps: Probe[]): string[] => ps.map((p) => p.name);
