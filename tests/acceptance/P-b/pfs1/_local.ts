// P-b · PF-S1 · HUB-FR-120/121 · ADM-FR-68/69 · PB-R01/02/06/08/20/21 · helper riêng thư mục pfs1 (không chứa `it(...)`).
// Dựng Hub in-process (seam `sourceCheckTimeoutMs`, C13) trên DB sạch P-a (acme + beta + platform). Mọi request đi qua HTTP (JSON
// thô), KHÔNG import type contract chưa tồn tại ⇒ file biên dịch được trước code S1. Mọi jsonb qua `sql.json`, mảng uuid qua
// `sql.array(…, 2950)` (CONVENTIONS §2 bẫy).
import { expect } from "bun:test";
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { newJobToken, tokenHash } from "../../H2a/_runtime2";
import {
  api,
  type CtxPa,
  defInput,
  type Json,
  PA,
  type Role,
  type Sql,
  setupPa,
  stageDef,
  T,
  waitFor,
} from "../../P-a/_support/pa";

export { type Json, PA, type Role, type Sql, stageDef, T, waitFor };

export const X = (n: number) => `b1b10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const URL_APP = "https://github.com/pb-test/app-repo.git";
export const LOCAL_PATH = "/qc-roots/pb-docs";

export type Ctx1 = Omit<CtxPa, "hub" | "redis" | "rt"> & { base: string };

export async function startPfs1(opts: { checkTimeoutMs?: number } = {}): Promise<Ctx1> {
  const { sql, ready } = await setupPa();
  const k = await makeKeys();
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const sourceCheckTimeoutMs = opts.checkTimeoutMs ?? 1500;
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: "qc-pfs1-1",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    processEngine: true,
    processLoops: false,
    sourceCheckTimeoutMs,
    stageLauncher: { kick: async () => {} },
  } as unknown as HubDeps & Record<string, unknown>;
  // C13: `createApp({sourceCheckTimeoutMs})` — truyền cả ở config lẫn deps để bắt cả hai cách backend nhận seam.
  const cfg = {
    version: "0.0.0-test",
    corsOrigins: ["http://localhost:3100"],
    sourceCheckTimeoutMs,
  } as never;
  const app = createApp(cfg, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const base = `http://localhost:${server.port}`;
  const hub = { base, db, redis, instanceId: "qc-pfs1-1" } as never;
  const tok = (r: Role) => sign(k, PA[r]);
  return {
    sql,
    ready,
    k,
    base,
    tok,
    call: async (r, method, path, body) => api(hub, await tok(r), method, path, body),
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
      await sql.end();
    },
  } as Ctx1;
}

/** Gọi không token. */
export async function anon(c: Ctx1, method: string, path: string, body?: unknown) {
  const res = await fetch(`${c.base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

export const code = (r: { status: number; json: Json }) => ({
  status: r.status,
  code: r.json?.error?.code as string | undefined,
});

/**
 * VALIDATION_ERROR: spec/test-plan ghi 422 nhưng `VALIDATION_ERROR` toàn hệ thống hiện là 400 (common.ts) ⇒ chấp nhận cả hai,
 * chuẩn hoá về 422 để so sánh mã. Chốt status do backend-lead ("Cần bổ sung").
 */
export const vcode = (r: { status: number; json: Json }) => {
  const c = code(r);
  return { status: c.status === 400 || c.status === 422 ? 422 : c.status, code: c.code };
};

// ---------- thân request ----------
export const gitBody = (key: string, o: Json = {}): Json => ({
  key,
  kind: "git_remote",
  config: { kind: "git_remote", url: o.url ?? URL_APP, branch: o.branch ?? "main" },
  description: o.description ?? `Nguồn ${key}`,
  ...(o.tenant_id ? { tenant_id: o.tenant_id } : {}),
});
export const libBody = (key: string, documentId: string, o: Json = {}): Json => ({
  key,
  kind: "library",
  config: { kind: "library", document_id: documentId },
  description: o.description ?? `Tài liệu ${key}`,
  ...(o.tenant_id ? { tenant_id: o.tenant_id } : {}),
});
export const localBody = (key: string, o: Json = {}): Json => ({
  key,
  kind: "local_path",
  config: { kind: "local_path", path: o.path ?? LOCAL_PATH },
  description: o.description ?? `Thư mục ${key}`,
  ...(o.tenant_id ? { tenant_id: o.tenant_id } : {}),
});
export const putBody = (cfg: Json, version: number, description = "Sửa"): Json => ({
  config: cfg,
  description,
  version,
});

export const mkSource = (c: Ctx1, role: Role, body: Json) =>
  c.call(role, "POST", "/admin/sources", body);

/** Chèn nguồn thẳng SQL (owner) — bỏ qua validate của POST (vd local_path có sẵn, library trỏ tài liệu tenant khác). */
export async function insertSource(
  sql: Sql,
  o: { id?: string; tenant: string; key: string; kind: string; config: Json; version?: number },
): Promise<string> {
  const id = o.id ?? crypto.randomUUID();
  const [t] = await sql<{ ok: boolean }[]>`select to_regclass('hub.sources') is not null as ok`;
  expect({ table_hub_sources: t?.ok }).toEqual({ table_hub_sources: true }); // đỏ đúng lý do: chưa có 0021
  await sql`insert into hub.sources (id, tenant_id, key, kind, config, description, version)
    values (${id}, ${o.tenant}, ${o.key}, ${o.kind}, ${sql.json(o.config)}, ${`Nguồn ${o.key}`}, ${o.version ?? 1})`;
  return id;
}

// ---------- kho library (H2c) ----------
/**
 * Chèn tài liệu library (origin `library`) cho `userId`/`tenant`. Trả id, hoặc `null` nếu schema chưa cho origin `library`
 * (⇒ ca đòi tài liệu đỏ ở `expect(id).not.toBeNull()` — "Cần bổ sung" backend-lead: 0021 phải nới `attachments_origin_check`).
 */
export async function seedLibraryDoc(
  sql: Sql,
  o: { tenant: string; userId: string; id?: string; name?: string },
): Promise<string | null> {
  const id = o.id ?? crypto.randomUUID();
  const name = o.name ?? "quy-dinh.md";
  try {
    await sql`insert into hub.attachments (id, tenant_id, user_id, origin, job_id, filename, safe_name, mime, size, sha256,
        storage_key) values (${id}, ${o.tenant}, ${o.userId}, 'library', null, ${name}, ${name}, 'text/markdown', 64,
        ${"a".repeat(64)}, ${`${o.tenant}/${id}`})`;
    return id;
  } catch {
    return null;
  }
}

// ---------- định nghĩa quy trình qua API ----------
/** Body `POST /process-defs` có nguồn: stage `s1` tham chiếu `sourceKey` (+ allowlist/must_know). */
export function defWithSource(key: string, sourceKey: string, o: Json = {}): Json {
  const base = defInput({
    key,
    name: o.name ?? `Quy trình ${key}`,
    stages: [
      {
        ...stageDef({ key: "s1", name: "Đọc nguồn", after: { kind: "auto" } }),
        sources: o.stageSources ?? [{ source_key: sourceKey, allowlist: ["src/**"] }],
        must_know: o.must_know ?? [],
      },
    ],
  });
  return { ...base, sources: o.sources ?? [sourceKey], inputs: o.inputs ?? [] };
}

// ---------- stub Runtime cho job `source.resolve` (check) ----------
export type ResolveJob = {
  id: string;
  tenant_id: string;
  payload: Json;
  token: string;
};
export type Answer =
  | { status: "ok"; pin?: Json; files?: number; bytes?: number }
  | { status: "error"; code: string; message?: string }
  | "silent";

/**
 * Như Runtime: claim job `source.resolve` queued (→ running), gán job-token mới, rồi trả lời theo `answer(job)` bằng
 * `POST /internal/jobs/:id/sources-resolved`. `silent` = không trả lời (K-04). Gọi `stop()` ở cuối ca.
 */
export function resolveStub(c: Ctx1, answer: (j: ResolveJob) => Answer | Promise<Answer>) {
  const seen: ResolveJob[] = [];
  const posts: { jobId: string; status: number; json: Json }[] = [];
  let live = true;
  const loop = (async () => {
    while (live) {
      const rows = await c.sql<
        { id: string; tenant_id: string; payload: Json }[]
      >`select id, tenant_id, payload
        from hub.jobs where payload->>'type' = 'source.resolve' and status = 'queued' order by created_at limit 5`;
      for (const r of rows) {
        const token = newJobToken();
        const upd =
          await c.sql`update hub.jobs set status = 'running', worker_id = 'qc-rt-1', started_at = now(),
          heartbeat_at = now(), token_hash = ${tokenHash(token)} where id = ${r.id} and status = 'queued' returning id`;
        if (upd.length === 0) continue;
        const job: ResolveJob = { id: r.id, tenant_id: r.tenant_id, payload: r.payload, token };
        seen.push(job);
        const a = await answer(job);
        if (a === "silent") continue;
        const items = (job.payload.items ?? []) as Json[];
        const results = items.map((it) => resultFor(it, a));
        const res = await postResolved(c, job.id, job.token, { results });
        posts.push({ jobId: job.id, ...res });
        await c.sql`update hub.jobs set status = 'succeeded', finished_at = now() where id = ${job.id}
          and status = 'running'`;
      }
      await Bun.sleep(40);
    }
  })();
  const handle = {
    seen,
    posts,
    stop: async () => {
      live = false;
      await loop;
      active.delete(handle);
    },
  };
  active.add(handle);
  return handle;
}
const active = new Set<{ stop: () => Promise<void> }>();

function resultFor(item: Json, a: Exclude<Answer, "silent">): Json {
  if (a.status === "error")
    return {
      status: "error",
      source_id: item.source_id,
      code: a.code,
      ...(a.message ? { message: a.message } : {}),
    };
  const cfg = item.config as Json;
  const pin =
    a.pin ??
    (cfg.kind === "git_remote"
      ? { kind: "git_remote", url: cfg.url, sha: "0123456789abcdef0123456789abcdef01234567" }
      : cfg.kind === "local_path"
        ? { kind: "local_path", path: cfg.path, snapshot_id: X(900) }
        : { kind: "library", document_id: cfg.document_id, version: X(901) });
  return {
    status: "ok",
    source_id: item.source_id,
    pin,
    files: a.files ?? 6,
    bytes: a.bytes ?? 2048,
  };
}

export async function postResolved(
  c: Ctx1,
  jobId: string,
  token: string | null,
  body: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${c.base}/internal/jobs/${jobId}/sources-resolved`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

/** Dọn dữ liệu mỗi ca: xoá nguồn + def tự tạo (giữ seed), job resolve. */
export async function resetPfs1(sql: Sql): Promise<void> {
  for (const h of [...active]) await h.stop(); // stub còn sót vì ca đỏ giữa chừng
  await sql`delete from hub.jobs where payload->>'type' = 'source.resolve'`;
  await sql`delete from hub.process_defs where key like 'pbx-%' or key = 'p-src'`;
  const t = await sql`select to_regclass('hub.sources') as r`;
  if (t[0]?.r) await sql`delete from hub.sources`;
}
