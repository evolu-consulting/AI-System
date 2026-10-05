// HUB-BR-04 · WRK-FR-15 · WRK-FR-22 · hạ tầng int H3a (test-plan H3a §2.1): DB sạch + fixture H1 + catalog/mock Dify H2a
// + agent H2b, hub-api thật, `ScriptRuntime` đóng vai Runtime. Đổi `hub.provider_state` qua SQL owner; ca tự khôi phục `ok`.
// Provider của Orchestrator/agent trong fixture H1 (`_hub.ts`, profile `fake-1`) là `fake-cli` (qc đã xác nhận —
// cases §2 "Chung": test-plan ghi `claude-sub` là khoá production; hành vi Hub theo khoá provider của job).
import { expect } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  type Json,
  type Keys,
  makeKeys,
  type Sql,
  sign,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import { type HubX, insertConv, runIdOf, type Sse, send, testRedis } from "../H1/_hub";
import { ScriptRuntime } from "../H1/_runtime";
import { type Dify, startDify } from "../H2a/_h2a";
import { type H2bExtra, setupH2b, startHubH2b } from "../H2b/_h2b";

export { H1_EXHAUSTED, R08, type R08Reason, type R08Text } from "./_r08";

/** Khoá provider của mọi agent fixture H1 (Orchestrator, assistant, helper). */
export const PROVIDER = "fake-cli";
/** Mảnh không được lộ trong `run.failed` (H1 A26 FORBIDDEN + R17). */
export const FORBIDDEN = [
  "claude-sub",
  "fake-cli",
  "claude",
  "anthropic",
  "@",
  "/home/",
  "stacktrace",
];

export type ProviderStatus = "ok" | "busy" | "cooldown" | "logged_out" | "error";

/** UPSERT `hub.provider_state` (owner); `until` = ms tương đối so với giờ DB, hoặc `null`. */
export async function setProvider(
  sql: Sql,
  status: ProviderStatus,
  untilMs: number | null = null,
  key = PROVIDER,
): Promise<void> {
  const until = untilMs === null ? null : `${untilMs} milliseconds`;
  await sql`insert into hub.provider_state (provider_key, status, cooldown_until)
    values (${key}, ${status}, now() + ${until}::interval)
    on conflict (provider_key) do update set status = excluded.status,
      cooldown_until = excluded.cooldown_until, updated_at = now()`;
}
/** Khôi phục `ok` (TC-6) — gọi ở `finally`. */
export const resetProvider = (sql: Sql, key = PROVIDER): Promise<void> =>
  setProvider(sql, "ok", null, key);

/** Chạy `body` với provider ở trạng thái cho trước, luôn trả về `ok`. */
export async function withProvider<V>(
  sql: Sql,
  status: ProviderStatus,
  untilMs: number | null,
  body: () => Promise<V>,
): Promise<V> {
  await setProvider(sql, status, untilMs);
  try {
    return await body();
  } finally {
    await resetProvider(sql);
  }
}

export type H3aCtx = {
  sql: Sql;
  k: Keys;
  hub: HubX;
  redis: Redis;
  rt: ScriptRuntime;
  dify: Dify;
  stop: () => Promise<void>;
};

/** DB sạch + H1/H2a/H2b fixture, mock Dify (MK), hub-api thật (`startHubH2b`), Redis test, `ScriptRuntime`. */
export async function startH3a(extra: H2bExtra = {}): Promise<H3aCtx> {
  const dify = startDify();
  const sql = await setupH2b({ catalogBaseUrl: dify.baseUrl });
  const k = await makeKeys();
  const hub = await startHubH2b(k, { instanceId: "qc-hub-h3a", ...extra });
  const redis = await testRedis();
  const rt = new ScriptRuntime(sql, redis);
  const stop = async () => {
    await hub.stop();
    await dify.close();
    redis.disconnect();
    await sql.end();
  };
  return { sql, k, hub, redis, rt, dify, stop };
}

export type Started = { s: Sse; runId: string; conv: string };
/** E12 trên hội thoại mới của `who`; 200 bắt buộc. */
export async function startRun(
  x: H3aCtx,
  who: UserKey,
  content: string,
  hub: HubX = x.hub,
): Promise<Started> {
  const conv = await insertConv(x.sql, who, crypto.randomUUID());
  const s = await send(hub, await sign(x.k, USERS[who]), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv };
}
/** Chờ sự kiện kết thúc rồi đóng stream. */
export async function endOf(s: Sse, ms = 10_000): Promise<{ event?: string; data: Json }> {
  const e = await s.terminal(ms);
  s.close();
  return { event: e?.event, data: e?.data };
}

export type JobRow = {
  type: string;
  provider_key: string;
  status: string;
  error_code: string | null;
  error_reason: string | null;
};
/** Mọi job của run (thứ tự tạo). */
export const jobsOfRun = (sql: Sql, runId: string): Promise<JobRow[]> =>
  sql<JobRow[]>`select type, provider_key, status, error_code, error_reason from hub.jobs
    where run_id = ${runId} order by created_at, id`.then((rs) => rs.map((r) => ({ ...r })));

/** `message`/`hint` không lộ provider/tài khoản/giờ (H1-R26, R17). */
export function expectNoLeak(data: Json): void {
  const raw = JSON.stringify({ message: data?.message, hint: data?.hint });
  for (const bad of FORBIDDEN)
    expect({ bad, hit: raw.toLowerCase().includes(bad) }).toEqual({ bad, hit: false });
  expect(raw).not.toMatch(/\d/);
}
