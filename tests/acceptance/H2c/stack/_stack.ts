// WRK-FR-11, WRK-FR-18, WRK-BR-07, HUB-FR-12 · hạ tầng test nhóm S H2c (test-plan-py §3 S01–S07, test-plan §2 "Stack"):
// hub-api THẬT trên host (env `HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR=<mkdtemp tuyệt đối>`, `HUB_MAX_CONCURRENT_RUNS=2`
// tường minh — L6 H2b) + agent-runtime THẬT trong container (`fake-cli`, `AGENT_RT_HUB_URL=http://host.docker.internal:<hub>`)
// + mock Dify MK (`/v1/files/upload` — MK-U) + Postgres/Redis compose. Dùng lại khởi động H2a (`startHubProcH2a` truyền
// `process.env` ⇒ biến `HUB_ATTACH_*` đặt ở đây tới được hub-api; `startRuntimeH2a` `--add-host …:host-gateway`, TC-4) và
// tiện ích H2b `stack/_stack.ts` (`endOf`, `settleStack`, `agentResultOf` — kiểu `StackH2b` ⊂ `StackH2c`). Fixture = H1 +
// catalog/agent H2a + agent H2b + catalog H2c (`insertH2cCatalog`). Không chứa `it(...)`.
//
// TC-4 + upload Dify (Lệch S05): workflow `hoadon-file` vừa được Hub (host) gọi `/files/upload` trước enqueue (`/hoadon-async`)
// vừa được Runtime (container) gọi `/workflows/run` theo `base_url` của credential ⇒ không dùng được `localhost` (container) lẫn
// `host.docker.internal` (hosts Windows có thể trỏ IP cũ). `base_url` của `hoadon-file` = IPv4 không-loopback của máy host
// (MK nghe 0.0.0.0; container tới được IP LAN/vEthernet của host — đã thử trên Docker Desktop), không có IP ⇒ `HOST_ALIAS`.
// Chạy riêng: `bun run test:h2c:stack` (`bunfig.stack.toml`; không song song test:int TS/Python cùng DB).
import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import {
  call,
  insertFixture,
  type Json,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  sign,
  USERS,
  type UserKey,
  waitFor,
} from "../../H1/_fixtures";
import { insertConv, insertHubConfig, runIdOf } from "../../H1/_hub";
import { insertCatalog, insertH2aAgents, startDify } from "../../H2a/_h2a";
import { endSqlRun } from "../../H2a/_h2a2";
import { HOST_ALIAS, startHubProcH2a, startRuntimeH2a } from "../../H2a/stack/_stack";
import { insertH2bAgents } from "../../H2b/_h2b";
import type { StackH2b, StackRun } from "../../H2b/stack/_stack";
import { insertH2cCatalog, sendWith, sha256, uploadOk, WF3 } from "../_h2c";

export const STACK_MAX_RUNS = "2";
export type StackH2c = StackH2b & { attachDir: string; difyBothUrl: string };

/** IPv4 không-loopback đầu tiên của host (host và container cùng tới được); không có ⇒ `HOST_ALIAS`. */
export function hostIp(): string {
  const all = Object.values(networkInterfaces()).flat();
  return all.find((i) => i && i.family === "IPv4" && !i.internal)?.address ?? HOST_ALIAS;
}

/** DB sạch + fixture H1/H2a/H2b/H2c + hub-api (host, storage thư mục tạm) + Runtime `providers` (container `rtName`). */
export async function bootStackH2c(
  rtName: string,
  rtEnv: Record<string, string> = {},
  providers = "fake-cli",
): Promise<StackH2c> {
  const attachDir = await mkdtemp(join(tmpdir(), "qc-h2c-stack-"));
  process.env.HUB_MAX_CONCURRENT_RUNS = STACK_MAX_RUNS;
  process.env.HUB_ATTACH_DRIVER = "local";
  process.env.HUB_ATTACH_DIR = attachDir;
  await prepareDb();
  const sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  const dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl, extras: true });
  await sql`update admin.workflows set base_url = ${dify.baseUrl.replace("localhost", HOST_ALIAS)}
    where id in (select workflow_id from admin.commands where mode = 'async')`;
  await insertH2aAgents(sql);
  await insertH2bAgents(sql);
  await endSqlRun(sql, R.runLive);
  await insertH2cCatalog(sql, dify.baseUrl);
  const difyBothUrl = dify.baseUrl.replace("localhost", hostIp());
  await sql`update admin.workflows set base_url = ${difyBothUrl} where id = ${WF3.hoadonFile}`;
  const k = await makeKeys();
  const hub = await startHubProcH2a(k);
  const rt = await startRuntimeH2a(rtName, `${rtName}-1`, {
    providers,
    hubUrl: hub.publicUrl,
    env: rtEnv,
  });
  return {
    sql,
    k,
    hub,
    dify,
    rt,
    attachDir,
    difyBothUrl,
    token: (who) => sign(k, USERS[who]),
    stop: async () => {
      rt.stop();
      await hub.stop();
      await dify.close();
      await sql.end();
      await rm(attachDir, { recursive: true, force: true });
    },
  };
}

/** `POST /attachments` của `who` (201 bắt buộc) → `{id, name, bytes, sha}`. */
export type Up = { id: string; name: string; bytes: Uint8Array; sha: string };
export async function up(
  st: StackH2c,
  name: string,
  bytes: Uint8Array,
  who: UserKey = "lan",
): Promise<Up> {
  const id = await uploadOk(st.hub, await st.token(who), bytes, name);
  return { id, name, bytes, sha: sha256(bytes) };
}

/** E12 có `attachment_ids` vào hội thoại mới (hoặc `conv`/`flowId` cũ); 200 SSE bắt buộc. */
export async function runWith(
  st: StackH2c,
  content: string,
  ids?: string[],
  o: { who?: UserKey; conv?: string; flowId?: string } = {},
): Promise<StackRun> {
  const who = o.who ?? "lan";
  const conv = o.conv ?? (await insertConv(st.sql, who, crypto.randomUUID()));
  const s = await sendWith(st.hub, await st.token(who), conv, content, ids, o.flowId);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv, flowId: s.headers.get("x-flow-id") ?? "" };
}

/** Tin của flow (E11, tải lại lịch sử). */
export async function flowMessages(st: StackH2c, x: StackRun): Promise<Json[]> {
  const res = await call(st.hub, "GET", `/conversations/${x.conv}/messages?flow_id=${x.flowId}`, {
    token: await st.token("lan"),
  });
  expect(res.status).toBe(200);
  return (res.json?.items ?? []) as Json[];
}
/** Tin `assistant` mới nhất của flow (E11 sắp cũ → mới). */
export async function assistantMsg(st: StackH2c, x: StackRun): Promise<Json> {
  return (await flowMessages(st, x)).filter((m) => m.role === "assistant").at(-1);
}

/** `GET /attachments/:id/content` của `lan` → status + byte. */
export async function contentOf(
  st: StackH2c,
  id: string,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${st.hub.base}/attachments/${id}/content`, {
    headers: { authorization: `Bearer ${await st.token("lan")}` },
  });
  return { status: res.status, text: await res.text() };
}

/** Job mới nhất của run có `payload.agent.<field>` = `value` (id + payload). */
export async function agentJob(
  st: StackH2c,
  runId: string,
  value: string,
  field: "key" | "role" = "key",
): Promise<{ id: string; payload: Json } | undefined> {
  const [row] = await st.sql<{ id: string; payload: Json }[]>`select id, payload from hub.jobs
    where run_id = ${runId} and payload->'agent'->>${field} = ${value}
    order by created_at desc limit 1`;
  return row;
}

/** Chờ job agent `key` của run sang `running` (Runtime đã claim). */
export async function runningJob(st: StackH2c, runId: string, key: string): Promise<string> {
  const row = await waitFor(
    () =>
      st.sql<{ id: string; status: string }[]>`select id, status from hub.jobs
        where run_id = ${runId} and payload->'agent'->>'key' = ${key}`,
    (rs) => rs.some((r) => r.status === "running"),
    30_000,
  );
  const id = row.find((r) => r.status === "running")?.id;
  expect(id).toBeDefined();
  return id ?? "";
}

/** Tên file trong `work/<job_id>/<sub>` của container Runtime (sắp xếp). */
export function workFiles(st: StackH2c, jobId: string, sub: string): string[] {
  const out = st.rt.exec(`ls -1 /tmp/qc-work/${jobId}/${sub} 2>/dev/null`);
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

/** Kết quả `#fake:files`: `<tên>:<sha>` sắp theo tên (code point), nối `\n`. */
export const filesLines = (fs: readonly Up[]): string =>
  [...fs]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((f) => `${f.name}:${f.sha}`)
    .join("\n");
