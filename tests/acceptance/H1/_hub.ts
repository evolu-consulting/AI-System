// HUB-FR-20, HUB-FR-42, HUB-FR-89 · hạ tầng test int H1 nhóm A (QW-A2, test-plan H1 §2): cấu hình Hub bằng SQL owner,
// hub-api thật kèm deps nền (instance, hạn chờ job, poll cấu hình, dừng), đọc SSE, gửi tin E12. Không chứa `it(...)`.
// Bổ sung `_fixtures.ts` (QW-A1), không đổi hằng/chữ ký cũ. Fixture không giữ trạng thái chung giữa ca.
import { TERMINAL_EVENTS } from "@ai/contracts/chat";
import type postgres from "postgres";
import { createApp } from "../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis, type Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  type CallOpts,
  HUB_API_URL,
  type Hub,
  type HubDeps,
  type Json,
  type Keys,
  REDIS_TEST_URL,
  type Sql,
  T,
  USERS,
  type UserKey,
} from "./_fixtures";

// ---------- id cố định (tiền tố riêng QW-A2, không trùng `_fixtures.ts`) ----------
const h = (n: number) => `a2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Bộ sinh uuid tất định cho dữ liệu tạo trong ca (mỗi file một dải `base`). */
export function idGen(base: number): () => string {
  let n = base;
  return () => h(n++);
}

export const AG = {
  orchestrator: h(301),
  assistant: h(302),
  helper: h(303),
  hoadon: h(304),
} as const;
export const PROFILE = { fake: h(311), claude: h(312) } as const;
export const ORCH_PROMPT = "Bạn là Orchestrator của hệ thống thử nghiệm QW-A2.";
export const AGENT_DESC = {
  assistant: "Trợ lý chung trả lời câu hỏi văn phòng.",
  helper: "Trợ lý phụ xử lý việc soạn thảo văn bản.",
  hoadon: "Tra cứu và tổng hợp hoá đơn của doanh nghiệp.",
} as const;

/**
 * Cấu hình Hub tối thiểu như `hub:seed` (plan §3.1, §3.6) bằng SQL owner: provider `fake-cli`/`claude-sub`, profile
 * `fake-1`, agent `orchestrator` + `assistant`, `helper` (acme, beta) + `hoadon` (chỉ entitlement beta, grant `lan`
 * — không thấy ở acme), `orchestrator_settings` (5 bước, 200 000 token, history 10), `hub_config_version` = 1.
 */
export async function insertHubConfig(sql: Sql): Promise<void> {
  await sql`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only) values
    ('fake-cli', 'subscription', 'fake', 2, true, true),
    ('claude-sub', 'subscription', 'anthropic', 2, true, false)`;
  const step = (p: string) => [{ provider_key: p, model: null, on: [] }];
  await sql`insert into hub.model_profiles (id, key, steps) values
    (${PROFILE.fake}, 'fake-1', ${sql.json(step("fake-cli"))}),
    (${PROFILE.claude}, 'claude-sub-1', ${sql.json(step("claude-sub"))})`;
  const agent = (id: string, key: string, desc: string, prompt = "") => ({
    id,
    key,
    name: sql.json({ vi: key, en: key }),
    description: desc,
    runtime: "agentic-cli",
    profile_id: PROFILE.fake,
    system_prompt: prompt,
  });
  await sql`insert into hub.agents ${sql([
    agent(AG.orchestrator, "orchestrator", "Điều phối yêu cầu tới agent phù hợp.", ORCH_PROMPT),
    agent(AG.assistant, "assistant", AGENT_DESC.assistant),
    agent(AG.helper, "helper", AGENT_DESC.helper),
    agent(AG.hoadon, "hoadon", AGENT_DESC.hoadon),
  ])}`;
  await sql`insert into hub.orchestrator_settings (id, agent_id, max_steps, token_budget, history_n)
    values (1, ${AG.orchestrator}, 5, 200000, 10)`;
  await sql`insert into hub.agent_entitlements (agent_id, tenant_id) values
    (${AG.assistant}, ${T.acme}), (${AG.assistant}, ${T.beta}),
    (${AG.helper}, ${T.acme}), (${AG.helper}, ${T.beta}), (${AG.hoadon}, ${T.beta})`;
  const grants = (["lan", "hoa", "tam"] as UserKey[]).flatMap((who) =>
    [AG.assistant, AG.helper, AG.hoadon].map((a) => ({
      agent_id: a,
      tenant_id: USERS[who].tid,
      subject_type: "user",
      subject_id: USERS[who].id,
    })),
  );
  grants.push(
    ...[AG.assistant, AG.helper].map((a) => ({
      agent_id: a,
      tenant_id: T.beta,
      subject_type: "user",
      subject_id: USERS.an.id,
    })),
  );
  await sql`insert into hub.agent_grants ${sql(grants)}`;
  await sql`update hub.config_meta set hub_config_version = 1 where id = 1`;
}

/** Đổi cấu hình Hub như `hub:seed`: áp `apply` + `hub_config_version + 1`, rồi NOTIFY `hub_config_changed` (nếu `notify`). */
export async function hubConfigChange(
  sql: Sql,
  apply: (tx: postgres.TransactionSql) => Promise<unknown>,
  notify = true,
): Promise<number> {
  const v = await sql.begin(async (tx) => {
    await apply(tx);
    const [r] = await tx<{ v: number }[]>`update hub.config_meta
      set hub_config_version = hub_config_version + 1 where id = 1 returning hub_config_version as v`;
    return r?.v ?? 1;
  });
  if (notify) await sql.notify("hub_config_changed", JSON.stringify({ v: 1, version: v }));
  return v;
}

/** Hội thoại mới của `who` (SQL owner, không qua route). */
export async function insertConv(
  sql: Sql,
  who: UserKey,
  id: string,
  title = "Hội thoại thử",
): Promise<string> {
  const x = USERS[who];
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
    values (${id}, ${x.tid}, ${x.id}, ${title}, ${title.toLowerCase()})`;
  return id;
}

/** Flow có sẵn (tuỳ chọn `agent_id`, các tin `msgs` theo thứ tự thời gian tăng 1 giây/tin). */
export async function insertFlow(
  sql: Sql,
  who: UserKey,
  conv: string,
  id: string,
  o: {
    agentId?: string | null;
    pendingAsk?: boolean;
    msgs?: { role: "user" | "assistant"; content: string }[];
  } = {},
): Promise<string> {
  const x = USERS[who];
  const msgs = o.msgs ?? [];
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, agent_id, pending_ask, message_count)
    values (${id}, ${x.tid}, ${x.id}, ${conv}, 'Flow có sẵn', ${o.agentId ?? null}, ${o.pendingAsk ?? false},
            ${Math.max(msgs.length, 1)})`;
  for (const [i, m] of msgs.entries()) {
    await sql`insert into hub.messages (tenant_id, user_id, conversation_id, flow_id, role, content, created_at)
      values (${x.tid}, ${x.id}, ${conv}, ${id}, ${m.role}, ${m.content},
              now() - interval '1 hour' + ${i}::int * interval '1 second')`;
  }
  return id;
}

// ---------- hub-api thật + deps nền ----------
/**
 * Deps thêm cho QW-A2 (ghi cho backend-lead, spec-decisions QW-A2): đều **tuỳ chọn**, vắng → theo env/mặc định plan §7.
 * `instanceId` (= `HUB_INSTANCE_ID`, chủ run/lease) · `jobMaxWaitS` (= `HUB_JOB_MAX_WAIT_S`) · `configPollS`
 * (= `HUB_CONFIG_POLL_S`) · `signal` (abort = dừng mọi vòng nền: Orchestrator, SseWriter, lease, sweeper, LISTEN).
 */
export type HubExtra = {
  instanceId?: string;
  jobMaxWaitS?: number;
  configPollS?: number;
  signal?: AbortSignal;
};
export type HubX = Hub & { instanceId: string };

export async function startHubX(k: Keys, extra: Omit<HubExtra, "signal"> = {}): Promise<HubX> {
  const db = connectDb(HUB_API_URL, 5);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = extra.instanceId ?? "qc-hub-a";
  const deps: HubDeps & HubExtra = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    ...extra,
    instanceId,
    signal: ac.signal,
  };
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

/** Kết nối Redis riêng của test (DB 15) — đọc `sse:<id>`, đóng vai Runtime XADD `run:<id>`. */
export async function testRedis(): Promise<Redis> {
  const r = createRedis(REDIS_TEST_URL);
  await r.connect();
  return r;
}

// ---------- SSE ----------
export type SseEv = { id: number | null; event: string; data: Json };
export type Sse = {
  status: number;
  headers: Headers;
  /** Body JSON khi phản hồi không phải SSE (lỗi trước khi mở stream). */
  json: Json;
  events: SseEv[];
  /** Chờ sự kiện thoả `pred` (từ đầu stream); hết giờ → undefined. */
  until: (pred: (e: SseEv) => boolean, ms?: number) => Promise<SseEv | undefined>;
  /** Chờ sự kiện kết thúc (`run.finished`/`run.failed`). */
  terminal: (ms?: number) => Promise<SseEv | undefined>;
  close: () => void;
};
export const isTerminal = (e: SseEv): boolean =>
  (TERMINAL_EVENTS as readonly string[]).includes(e.event);

function parseJson(text: string): Json {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseFrame(raw: string): SseEv | null {
  const f: { id: number | null; event: string; data: string[] } = {
    id: null,
    event: "message",
    data: [],
  };
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue; // dòng rỗng / chú thích `: ping`
    const key = line.slice(0, i);
    const v = line.slice(i + 1).replace(/^ /, "");
    if (key === "id") f.id = Number(v);
    else if (key === "event") f.event = v;
    else if (key === "data") f.data.push(v);
  }
  if (f.data.length === 0) return null;
  return { id: f.id, event: f.event, data: parseJson(f.data.join("\n")) };
}

/** Tách các khung hoàn chỉnh (kết thúc bằng dòng trống) khỏi `buf`; trả `[khung, phần dư]`. */
function splitFrames(buf: string): [string[], string] {
  const frames = buf.split("\n\n");
  const rest = frames.pop() ?? "";
  return [frames, rest];
}

/** Đọc nền body SSE, đẩy từng sự kiện đã parse vào `events`; dừng khi đóng/abort. */
async function pump(body: ReadableStream<Uint8Array>, events: SseEv[]): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const [frames, rest] = splitFrames(
        buf + dec.decode(value, { stream: true }).replace(/\r\n/g, "\n"),
      );
      buf = rest;
      for (const fr of frames) {
        const ev = parseFrame(fr);
        if (ev) events.push(ev);
      }
    }
  } catch {
    // abort/đóng kết nối: dừng đọc
  }
}

/** Mở request SSE (E12/E13) và đọc nền; không SSE → body JSON. */
export async function openSse(
  hub: Hub,
  method: string,
  path: string,
  o: CallOpts = {},
): Promise<Sse> {
  const ac = new AbortController();
  const headers = new Headers(o.headers);
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  const body = o.body === undefined ? undefined : JSON.stringify(o.body);
  if (body !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(`${hub.base}${path}`, { method, headers, body, signal: ac.signal });
  const events: SseEv[] = [];
  let json: Json;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
    void pump(res.body, events);
  } else {
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
  }
  const until = async (pred: (e: SseEv) => boolean, ms = 10_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = events.find(pred);
      if (hit || Date.now() > end) return hit;
      await Bun.sleep(25);
    }
  };
  return {
    status: res.status,
    headers: res.headers,
    json,
    events,
    until,
    terminal: (ms = 10_000) => until(isTerminal, ms),
    close: () => ac.abort(),
  };
}

/** E12: gửi tin (không `flow_id` = flow mới). */
export function send(
  hub: Hub,
  token: string,
  conv: string,
  content: string,
  flowId?: string,
): Promise<Sse> {
  const body = flowId ? { content, flow_id: flowId } : { content };
  return openSse(hub, "POST", `/conversations/${conv}/messages`, { token, body });
}

export const runIdOf = (s: Sse): string => s.headers.get("x-run-id") ?? "";
export const deltaText = (evs: SseEv[]): string =>
  evs
    .filter((e) => e.event === "delta")
    .map((e) => String(e.data?.text ?? ""))
    .join("");

/** Đọc `sse:<id>` (Redis): danh sách `[id, sự kiện đã parse]`. */
export async function sseStream(r: Redis, runId: string): Promise<{ id: string; ev: Json }[]> {
  const rows = await r.xrange(`sse:${runId}`, "-", "+");
  return rows.map(([id, fields]) => {
    const raw = fields[fields.indexOf("e") + 1] ?? "null";
    return { id, ev: JSON.parse(raw) };
  });
}

/** Số sự kiện kết thúc trong `sse:<id>` (đúng một mỗi run). */
export async function terminalCount(r: Redis, runId: string): Promise<number> {
  const rows = await sseStream(r, runId);
  return rows.filter((x) => isTerminalName(x.ev?.event)).length;
}
const isTerminalName = (n: unknown): boolean =>
  typeof n === "string" && (TERMINAL_EVENTS as readonly string[]).includes(n);

/** Dòng `hub.runs` (owner). */
export async function runRow(sql: Sql, id: string): Promise<Json> {
  const [r] = await sql`select * from hub.runs where id = ${id}`;
  return r;
}

/** Khối `<tag>…</tag>` trong prompt Orchestrator (plan §6.2); thiếu → null. */
export function block(prompt: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(prompt);
  return m ? (m[1] ?? "") : null;
}

/** Postgres phụ (đếm deadlock, LISTEN). */
export const pgDeadlocks = async (sql: Sql): Promise<number> => {
  const [r] = await sql<{ n: number }[]>`select deadlocks::int as n from pg_stat_database
    where datname = current_database()`;
  return r?.n ?? 0;
};
