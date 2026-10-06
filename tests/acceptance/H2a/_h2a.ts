// HUB-FR-10, HUB-FR-13, HUB-FR-76, HUB-FR-89 · hạ tầng test int H2a nhóm A (test-plan H2a §2, cases §7): catalog Admin
// bằng SQL owner (secret mã bằng `encryptSecret` Admin với khoá test cố định, P6), mock Dify MK sau proxy, hub-api thật
// kèm deps H2a, quyền Admin tính lại từ SQL (A08). Không chứa `it(...)`. Dùng chung QW-A1 và QW-A2.
//
// Seam test ↔ hub-api (ghi cho backend-lead, test-plan §10 QW-A1): `createApp(cfg, deps)` nhận thêm deps H2a **tuỳ chọn**
// `secretMasterKey` (= SECRET_MASTER_KEY, base64 32 byte) · `internalToken` (= HUB_INTERNAL_TOKEN) · `publicInternalUrl`
// (= HUB_PUBLIC_INTERNAL_URL) · `difyTimeoutMaxS` (= HUB_DIFY_TIMEOUT_MAX_S). Factory không đọc env (như H1).
//
// Proxy Dify (lệch plan §9 / cases §7, ghi §10): CHECK `admin.secrets.ciphertext` ≥ 24 byte ⇒ app-key < 8 ký tự
// (`mk-ok`, `mk-401/404/400`) không lưu được. Secret lưu `<kịch bản>~pad`; proxy bỏ hậu tố rồi chuyển nguyên request tới MK
// (MK ghi `calls()` với key gốc). Key `LEAK_KEY_ECHO…` → proxy tự trả 400 với thân chứa key (thô/base64/hex) — MK không có
// kịch bản "thân lỗi chứa key" (A26, A80).
import { CommandMenuResponseSchema } from "@ai/contracts/chat";
import type postgres from "postgres";
import { encryptSecret, parseMasterKey } from "../../../apps/admin-api/src/lib/secret-crypto";
import { computeEffectiveAccess } from "../../../apps/admin-api/src/modules/access/access.rules";
import { createApp } from "../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../apps/hub-api/src/lib/redis";
import { type DifyMock, startDifyMock } from "../../../tools/hub-dev/src/dify-mock";
import {
  adminChange,
  call,
  HUB_API_URL,
  type HubDeps,
  type Json,
  type Keys,
  REDIS_TEST_URL,
  type Res,
  type Sql,
  T,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import { AG, type HubExtra, type HubX, PROFILE } from "../H1/_hub";

// ---------- id cố định (dải `a2a0…`, test-plan §1) ----------
const a = (n: number) => `a2a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Bộ sinh uuid tất định cho dữ liệu tạo trong ca (mỗi file một dải `base` ≥ 1000). */
export function idGen2(base: number): () => string {
  let n = base;
  return () => a(n++);
}

export const WF = {
  dich: a(1),
  tom: a(2),
  hoi: a(3),
  troLy: a(4),
  checkInvoice: a(5),
  trello: a(6),
  so: a(7),
  tat: a(8),
} as const;
export type WfName = keyof typeof WF;
export const WF_KEY: Record<WfName, string> = {
  dich: "dich",
  tom: "tom",
  hoi: "hoi",
  troLy: "tro-ly",
  checkInvoice: "check-invoice",
  trello: "create-trello-card",
  so: "so",
  tat: "tat",
};
/** Tên hiển thị workflow — chuỗi dễ dò để kiểm "không lộ tên workflow" (A16). */
export const WF_NAME = (w: WfName) => `WFNAME-${WF_KEY[w]}-qc`;
const SEC = (w: WfName) => a(10 + Object.keys(WF).indexOf(w) + 1);
export const CMD = {
  dich: a(21),
  tom: a(22),
  hoi: a(23),
  so: a(24),
  tat: a(25),
  dong: a(26),
  cham: a(27),
  dichAsync: a(28),
} as const;
export const FEAT = {
  core: a(31),
  translate: a(32),
  summary: a(33),
  labs: a(34),
  aaaDup: a(35),
} as const;
export const GRP = { staff: a(41) } as const;
export const AG2 = { trello: a(51), difyTom: a(52), difyTroLy: a(53) } as const;

// ---------- secret (khoá test cố định, KHÔNG phải khoá thật) ----------
export const TEST_MASTER_KEY_B64 = Buffer.from(
  Array.from({ length: 32 }, (_, i) => 0x40 + i),
).toString("base64");
export const INTERNAL_TOKEN = "qc-internal-token-0123456789abcdef0123";
/** Secret rò rỉ của `dich` (cases §7) và `check-invoice` (A55). */
export const LEAK_DICH = "LEAK_KEY_7f3a9c2e1b0d4f6a8e7c5b3a";
export const LEAK_INVOICE = "LEAK_KEY_a550f1e2d3c4b5a6978899a";
/** Key làm proxy trả 400 với thân chứa key (A26, A80). */
export const LEAK_ECHO = "LEAK_KEY_ECHO_4e1d2c3b4a5f6e7d8c9b";
/** Giá trị lưu trong `admin.secrets` cho một kịch bản MK (đủ 24 byte bản mã). */
export const stored = (scenario: string): string =>
  scenario.length >= 8 ? scenario : `${scenario}~pad`;
const masterKey = () => parseMasterKey(TEST_MASTER_KEY_B64);

/** Mọi dạng mã hoá của secret cần quét rò rỉ (A80): thô, base64, base64url, hex thường/hoa. */
export function leakForms(secret: string): string[] {
  const b = Buffer.from(secret, "utf8");
  const b64 = b.toString("base64");
  return [
    secret,
    b64,
    b64.replace(/=+$/, ""),
    b.toString("base64url"),
    b.toString("hex"),
    b.toString("hex").toUpperCase(),
  ];
}

/** Đặt app-key (kịch bản MK hoặc `LEAK_KEY_*`) cho secret của workflow `w` (mã lại, iv mới). */
export async function setAppKey(sql: Sql, w: WfName, scenario: string): Promise<void> {
  const value = stored(scenario);
  const s = encryptSecret(masterKey(), SEC(w), value);
  await sql`update admin.secrets set ciphertext = ${Buffer.from(s.ciphertext)}, iv = ${Buffer.from(s.iv)},
    key_version = 1, last4 = ${value.slice(-4)}, updated_at = now() where id = ${SEC(w)}`;
}
/** Bản mã hỏng (giải mã ném) — A25, A83. */
export async function corruptSecret(sql: Sql, w: WfName): Promise<void> {
  await sql`update admin.secrets set ciphertext = ${Buffer.alloc(40, 7)} where id = ${SEC(w)}`;
}
export const secretIdOf = SEC;

// ---------- proxy trước mock Dify ----------
export type Dify = {
  /** Base URL Dify của workflow (`<proxy>/v1`). */
  baseUrl: string;
  mock: DifyMock;
  /** Lời gọi tới `POST /v1/workflows/run` hoặc `/v1/chat-messages` (MK). */
  runs: () => ReturnType<DifyMock["calls"]>;
  stops: () => ReturnType<DifyMock["calls"]>;
  echoCount: () => number;
  close: () => Promise<void>;
};
const ECHO_PAD = "x".repeat(400);

function echoError(key: string): Response {
  const b = Buffer.from(key, "utf8");
  const message = `bad api key ${key} b64=${b.toString("base64")} hex=${b.toString("hex")} ${ECHO_PAD}`;
  return new Response(JSON.stringify({ code: "invalid_param", message, status: 400 }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

export function startDify(): Dify {
  const mock = startDifyMock();
  let echo = 0;
  const inflight = new Set<AbortController>();
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (key.startsWith("LEAK_KEY_ECHO")) {
        echo++;
        return echoError(key);
      }
      const headers = new Headers({ "content-type": req.headers.get("content-type") ?? "" });
      if (key) headers.set("authorization", `Bearer ${key.replace(/~pad$/, "")}`);
      const body = req.method === "POST" ? await req.arrayBuffer() : undefined;
      const up = new AbortController();
      inflight.add(up);
      const res = await fetch(`${mock.url}${u.pathname}${u.search}`, {
        method: req.method,
        headers,
        body,
        signal: up.signal,
      });
      const out = new Headers();
      for (const h of ["content-type", "cache-control"]) {
        const v = res.headers.get(h);
        if (v) out.set(h, v);
      }
      return new Response(relay(res, up), { status: res.status, headers: out });
    },
  });
  /** Chuyển body MK từng khối; client (Hub) đóng → huỷ upstream (mk-slow nghe huỷ); `close()` → huỷ mọi luồng. */
  const relay = (res: Response, up: AbortController): ReadableStream<Uint8Array> | null => {
    const reader = res.body?.getReader();
    if (!reader) {
      inflight.delete(up);
      return null;
    }
    const done = () => inflight.delete(up);
    return new ReadableStream<Uint8Array>({
      async pull(ctl) {
        try {
          const r = await reader.read();
          if (r.done) {
            done();
            ctl.close();
          } else ctl.enqueue(r.value);
        } catch {
          done();
          ctl.close();
        }
      },
      cancel() {
        up.abort();
        done();
      },
    });
  };
  const isRun = (p: string) => p === "/v1/workflows/run" || p === "/v1/chat-messages";
  return {
    baseUrl: `http://localhost:${server.port}/v1`,
    mock,
    runs: () => mock.calls().filter((c) => isRun(c.path)),
    stops: () => mock.calls().filter((c) => c.path.endsWith("/stop")),
    echoCount: () => echo,
    close: async () => {
      for (const up of inflight) up.abort();
      await server.stop(true);
      await mock.close();
    },
  };
}

// ---------- catalog Admin (cases §7) ----------
const desc = (vi: string) => ({ vi, en: null });
const arg = (name: string, o: Record<string, unknown> = {}) => ({
  name,
  description: { vi: `Tham số ${name}`, en: `Argument ${name}` },
  default: null,
  fallback: null,
  rest: false,
  ...o,
});
const inp = (
  name: string,
  type: string,
  required: boolean,
  extra: Record<string, unknown> = {},
) => ({
  name,
  type,
  required,
  description: `Biến ${name}`,
  ...extra,
});
export const ARGS_DICH = [arg("lang"), arg("text", { rest: true, fallback: "selection" })];
export const MAP_DICH = {
  target_lang: { source: "arg", value: "lang" },
  source_text: { source: "arg", value: "text" },
  tone: { source: "const", value: "neutral" },
};
export const OUT = { field: "text", render: "markdown" };

type WfRow = {
  w: WfName;
  app: string;
  inputs: unknown[];
  key: string;
  enabled?: boolean;
  d?: string;
};
const WORKFLOWS: WfRow[] = [
  {
    w: "dich",
    app: "workflow",
    key: "mk-ok",
    inputs: [
      inp("source_text", "text", true),
      inp("target_lang", "select", true, { options: ["en", "vi", "ja"] }),
      inp("tone", "text", false),
    ],
  },
  { w: "tom", app: "workflow", key: "mk-ok", inputs: [inp("source_text", "text", true)] },
  { w: "hoi", app: "chat", key: "mk-agent", inputs: [inp("query", "text", true)] },
  { w: "troLy", app: "agent", key: "mk-agent", inputs: [inp("query", "text", true)] },
  {
    w: "checkInvoice",
    app: "workflow",
    key: LEAK_INVOICE,
    d: "Kiểm tra một hoá đơn điện tử theo mã hoá đơn và trả kết quả đối chiếu.",
    inputs: [
      { ...inp("x", "text", false), description: "Mã hoá đơn" },
      { ...inp("y", "text", false), description: "Ghi chú" },
    ],
  },
  { w: "trello", app: "workflow", key: "mk-ok", inputs: [inp("title", "text", true)] },
  {
    w: "so",
    app: "workflow",
    key: "mk-ok",
    inputs: [inp("n", "number", true), inp("flag", "boolean", false)],
  },
  { w: "tat", app: "workflow", key: "mk-ok", enabled: false, inputs: [] },
];

type CmdRow = {
  c: keyof typeof CMD;
  name: string;
  wf: WfName;
  args: unknown[];
  map: Record<string, unknown>;
  aliases?: string[];
  enabled?: boolean;
  mode?: "sync" | "async";
  timeout?: number;
};
const COMMANDS: CmdRow[] = [
  { c: "dich", name: "dich", wf: "dich", args: ARGS_DICH, map: MAP_DICH, aliases: ["translate"] },
  {
    c: "tom",
    name: "tom",
    wf: "tom",
    args: [arg("text", { rest: true, fallback: "selection" })],
    map: { source_text: { source: "arg", value: "text" } },
  },
  {
    c: "hoi",
    name: "hoi",
    wf: "hoi",
    args: [arg("q", { rest: true })],
    map: { query: { source: "arg", value: "q" } },
  },
  {
    c: "so",
    name: "so",
    wf: "so",
    args: [arg("n"), arg("flag")],
    map: { n: { source: "arg", value: "n" }, flag: { source: "arg", value: "flag" } },
  },
  { c: "tat", name: "tat", wf: "tat", args: [], map: {} },
  { c: "dong", name: "dong", wf: "dich", args: ARGS_DICH, map: MAP_DICH, enabled: false },
];
/** Lệnh thêm cho file lỗi/secret (không có ở `commands` để A01 giữ đúng tập `{dich, hoi, so}`). */
const EXTRAS: CmdRow[] = [
  { c: "cham", name: "cham", wf: "dich", args: ARGS_DICH, map: MAP_DICH, timeout: 1 },
  { c: "dichAsync", name: "dich-async", wf: "dich", args: ARGS_DICH, map: MAP_DICH, mode: "async" },
];

export type CatalogOpts = { baseUrl: string; extras?: boolean };

/**
 * Catalog cases §7 bằng SQL owner. Feature: `core` (/hoi) · `translate` on (/dich, /so, /tat, /dong [+ /cham,
 * /dich-async]) · `summary` on, không entitlement acme (/tom) · `labs` beta (/so) · `aaa-dup` on (/dich). Group
 * `acme/staff` = lan, hoa; `acme/beta-testers` ∋ lan. Grant: core+translate+summary → staff; aaa-dup → hoa; labs → lan;
 * `beta/an` grant translate + entitlement translate. Provider `dify` (api, 5) cho `workflow.async` (P9).
 */
export async function insertCatalog(sql: Sql, o: CatalogOpts): Promise<void> {
  const key = masterKey();
  for (const [i, wf] of WORKFLOWS.entries()) {
    const value = stored(wf.key);
    const s = encryptSecret(key, SEC(wf.w), value);
    await sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4) values
      (${SEC(wf.w)}, ${`QW_SECRET_${i + 1}`}, ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.iv)}, 1,
       ${value.slice(-4)})`;
    await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id,
        input_schema, output_field, enabled) values
      (${WF[wf.w]}, ${WF_KEY[wf.w]}, ${WF_NAME(wf.w)},
       ${wf.d ?? `Workflow thử ${WF_KEY[wf.w]} dùng trong kiểm thử H2a.`}, ${wf.app}, ${o.baseUrl},
       ${SEC(wf.w)}, ${sql.json(wf.inputs as never)}, null, ${wf.enabled ?? true})`;
  }
  for (const c of [...COMMANDS, ...(o.extras ? EXTRAS : [])]) {
    await sql`insert into admin.commands (id, name, aliases, description, workflow_id, args, input_map, output,
        mode, timeout_s, enabled) values
      (${CMD[c.c]}, ${c.name}, ${sql.array(c.aliases ?? [])}, ${sql.json(desc(`Lệnh /${c.name}`))},
       ${WF[c.wf]}, ${sql.json(c.args as never)}, ${sql.json(c.map as never)}, ${sql.json(OUT)},
       ${c.mode ?? "sync"}, ${c.timeout ?? 30}, ${c.enabled ?? true})`;
    for (const n of [c.name, ...(c.aliases ?? [])])
      await sql`insert into admin.command_names (name, command_id) values (${n}, ${CMD[c.c]})`;
  }
  const feat = (id: string, k: string, status: string) => ({
    id,
    key: k,
    name: sql.json({ vi: k, en: k }),
    status,
  });
  await sql`insert into admin.features ${sql([
    feat(FEAT.core, "core", "on"),
    feat(FEAT.translate, "translate", "on"),
    feat(FEAT.summary, "summary", "on"),
    feat(FEAT.labs, "labs", "beta"),
    feat(FEAT.aaaDup, "aaa-dup", "on"),
  ])}`;
  const fc: [string, string][] = [
    [FEAT.core, CMD.hoi],
    [FEAT.translate, CMD.dich],
    [FEAT.translate, CMD.so],
    [FEAT.translate, CMD.tat],
    [FEAT.translate, CMD.dong],
    [FEAT.summary, CMD.tom],
    [FEAT.labs, CMD.so],
    [FEAT.aaaDup, CMD.dich],
  ];
  if (o.extras) fc.push([FEAT.translate, CMD.cham], [FEAT.translate, CMD.dichAsync]);
  await sql`insert into admin.feature_commands ${sql(fc.map(([f, c]) => ({ feature_id: f, command_id: c })))}`;
  await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values
    (${FEAT.translate}, ${T.acme}), (${FEAT.labs}, ${T.acme}), (${FEAT.aaaDup}, ${T.acme}),
    (${FEAT.translate}, ${T.beta})`;
  await sql`insert into admin.groups (id, tenant_id, key, name) values
    (${GRP.staff}, ${T.acme}, 'staff', ${sql.json({ vi: "Nhân viên" })})`;
  const beta = await betaGroup(sql, T.acme);
  await sql`insert into admin.group_members (tenant_id, group_id, user_id) values
    (${T.acme}, ${GRP.staff}, ${USERS.lan.id}), (${T.acme}, ${GRP.staff}, ${USERS.hoa.id}),
    (${T.acme}, ${beta}, ${USERS.lan.id})`;
  await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id) values
    (${T.acme}, ${FEAT.core}, ${GRP.staff}, null), (${T.acme}, ${FEAT.translate}, ${GRP.staff}, null),
    (${T.acme}, ${FEAT.summary}, ${GRP.staff}, null), (${T.acme}, ${FEAT.aaaDup}, null, ${USERS.hoa.id}),
    (${T.acme}, ${FEAT.labs}, null, ${USERS.lan.id}), (${T.beta}, ${FEAT.translate}, null, ${USERS.an.id})`;
  await sql`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
    values ('dify', 'api', 'dify', 5, true, false) on conflict (key) do nothing`;
  await markSideEffect(sql, WF.trello);
}

// X1 L01 (HUB-FR-95, plan X1 §0 K1–K2): có cột admin.workflows.side_effect (sau B1, thắng hẳn — R23) ⇒ update; chưa ⇒ workflow_flags.
export async function markSideEffect(sql: Sql, workflowId: string, on = true): Promise<void> {
  const [col] = await sql<{ n: number }[]>`select count(*)::int as n from information_schema.columns
    where table_schema = 'admin' and table_name = 'workflows' and column_name = 'side_effect'`;
  if ((col?.n ?? 0) > 0) {
    await sql`update admin.workflows set side_effect = ${on} where id = ${workflowId}`;
  } else {
    await sql`insert into hub.workflow_flags (workflow_id, side_effect) values (${workflowId}, ${on})
      on conflict (workflow_id) do update set side_effect = excluded.side_effect`;
  }
}

export async function betaGroup(sql: Sql, tenantId: string): Promise<string> {
  const [g] = await sql<{ id: string }[]>`select id from admin.groups
    where tenant_id = ${tenantId} and key = 'beta-testers'`;
  return g?.id ?? "";
}

/**
 * Agent H2a (cases §7) — cần `insertHubConfig` H1 trước (profile `fake-1`, agent `hoadon`): `trello` (agentic-cli) ↔
 * `create-trello-card`; `hoadon` ↔ `check-invoice`, `tat`; `dify-tom` (dify-workflow → `tom`, đúng một input
 * bắt buộc kiểu text — R48), `dify-tro-ly` (dify-agent → `tro-ly`). Entitlement acme + grant lan cho cả bốn; bump `hub_config_version`.
 */
export async function insertH2aAgents(sql: Sql): Promise<void> {
  const agent = (id: string, k: string, runtime: string, opts: Record<string, unknown> = {}) => ({
    id,
    key: k,
    name: sql.json({ vi: k, en: k }),
    description: `Agent thử ${k} cho kiểm thử H2a.`,
    runtime,
    profile_id: PROFILE.fake,
    runtime_options: sql.json(opts as never),
    timeout_s: 60,
  });
  await sql`insert into hub.agents ${sql([
    agent(AG2.trello, "trello", "agentic-cli"),
    agent(AG2.difyTom, "dify-tom", "dify-workflow", { workflow_key: "tom" }),
    agent(AG2.difyTroLy, "dify-tro-ly", "dify-agent", { workflow_key: "tro-ly" }),
  ])}`;
  await sql`insert into hub.agent_workflows (agent_id, workflow_id) values
    (${AG2.trello}, ${WF.trello}), (${AG.hoadon}, ${WF.checkInvoice}), (${AG.hoadon}, ${WF.tat})`;
  const ids = [AG2.trello, AG2.difyTom, AG2.difyTroLy, AG.hoadon];
  await sql`insert into hub.agent_entitlements ${sql(ids.map((agent_id) => ({ agent_id, tenant_id: T.acme })))}
    on conflict do nothing`;
  await sql`insert into hub.agent_grants ${sql(
    ids.slice(0, 3).map((agent_id) => ({
      agent_id,
      tenant_id: T.acme,
      subject_type: "user",
      subject_id: USERS.lan.id,
    })),
  )}`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

/** Đổi catalog như Admin (UPDATE + bump `config_meta` + NOTIFY `config_changed`). */
export const catalogChange = (sql: Sql, apply: (tx: postgres.TransactionSql) => Promise<unknown>) =>
  adminChange(sql, "tenant", T.acme, apply);

// ---------- hub-api thật + deps H2a ----------
export type H2aDeps = {
  secretMasterKey?: string;
  internalToken?: string;
  publicInternalUrl?: string;
  difyTimeoutMaxS?: number;
};

/** Như `startHubX` H1 + deps H2a; `publicInternalUrl` = base của chính hub test (cổng chọn trước khi dựng app). */
export async function startHubH2a(
  k: Keys,
  extra: Omit<HubExtra, "signal"> & Omit<H2aDeps, "publicInternalUrl"> = {},
): Promise<HubX> {
  const db = connectDb(HUB_API_URL, 5);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: () => new Response("starting", { status: 503 }),
  });
  const base = `http://localhost:${server.port}`;
  const instanceId = extra.instanceId ?? "qc-hub-h2a";
  const deps: HubDeps & HubExtra & H2aDeps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    jobMaxWaitS: 5,
    secretMasterKey: TEST_MASTER_KEY_B64,
    internalToken: INTERNAL_TOKEN,
    difyTimeoutMaxS: 300,
    ...extra,
    publicInternalUrl: base,
    instanceId,
    signal: ac.signal,
  };
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  server.reload({ fetch: app.fetch });
  return {
    base,
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

// ---------- menu `/commands` và quyền Admin ----------
/** `GET /commands` → tên lệnh (null nếu không 200 hoặc sai contract). */
export async function menuNames(hub: HubX, token: string): Promise<string[] | null> {
  const res: Res = await call(hub, "GET", "/commands", { token });
  if (res.status !== 200) return null;
  const p = CommandMenuResponseSchema.safeParse(res.json);
  return p.success ? p.data.items.map((i) => i.name) : null;
}

/** Tập lệnh `visible` theo `computeEffectiveAccess` Admin, dữ liệu đọc từ SQL hiện tại (A08, P5). */
export async function adminVisible(sql: Sql, who: UserKey): Promise<string[]> {
  const u = USERS[who];
  const [head] = await sql<
    { active: boolean; locked: boolean; tenant_active: boolean }[]
  >`select u.active, u.locked_by_tenant as locked, t.active as tenant_active
    from admin.users u join admin.tenants t on t.id = u.tenant_id where u.id = ${u.id}`;
  const groups = await sql<{ group_id: string }[]>`select group_id from admin.group_members
    where user_id = ${u.id}`;
  const feats = await sql<Json[]>`select f.id, f.key, f.status,
      exists (select 1 from admin.feature_entitlements e where e.feature_id = f.id and e.tenant_id = ${u.tid}
        and e.revoked_at is null) as entitled,
      array(select fg.group_id::text from admin.feature_grants fg where fg.feature_id = f.id
        and fg.tenant_id = ${u.tid} and fg.group_id is not null) as grant_group_ids,
      exists (select 1 from admin.feature_grants fg where fg.feature_id = f.id and fg.user_id = ${u.id}) as grant_user
    from admin.features f order by (f.key <> 'core'), f.key`;
  const cmds = await sql<Json[]>`select c.id, c.name, c.enabled, w.enabled as workflow_enabled,
      array(select fc.feature_id::text from admin.feature_commands fc where fc.command_id = c.id) as feature_ids
    from admin.commands c join admin.workflows w on w.id = c.workflow_id order by c.name`;
  const acc = computeEffectiveAccess({
    user: {
      id: u.id,
      active: head?.active ?? false,
      lockedByTenant: head?.locked ?? true,
      tenantActive: head?.tenant_active ?? false,
      groupIds: groups.map((g) => g.group_id),
    },
    betaGroupId: (await betaGroup(sql, u.tid)) || null,
    features: feats.map((f) => ({
      id: f.id,
      key: f.key,
      status: f.status,
      entitled: f.entitled,
      grantGroupIds: f.grant_group_ids,
      grantUser: f.grant_user,
    })),
    commands: cmds.map((c) => ({
      id: c.id,
      enabled: c.enabled,
      workflowEnabled: c.workflow_enabled,
      featureIds: c.feature_ids,
    })),
  });
  const visible = new Set(acc.commands.filter((c) => c.visible).map((c) => c.commandId));
  return cmds.filter((c) => visible.has(c.id)).map((c) => c.name as string);
}

/** Gom mọi chuỗi trong DB/Redis liên quan tới run để quét rò rỉ (A80). */
export async function dumpRun(sql: Sql, runId: string): Promise<string> {
  const parts = await Promise.all([
    sql`select * from hub.runs where id = ${runId}`,
    sql`select * from hub.run_steps where run_id = ${runId}`,
    sql`select * from hub.messages where run_id = ${runId} or id in
      (select user_message_id from hub.runs where id = ${runId})`,
    sql`select id, payload, result, error_code, error_reason, error_message from hub.jobs where run_id = ${runId}`,
    sql`select * from hub.usage_logs where run_id = ${runId}`,
    sql`select * from hub.tool_confirmations where run_id = ${runId}`,
  ]);
  return JSON.stringify(parts.map((p) => [...p]));
}
