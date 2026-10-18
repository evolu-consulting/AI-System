// HUB-FR-146/147 · ADM-FR-73 · AC-H44/H45/H47 · test-plan-d2 đầu file + §3: hạ tầng int P-d2 — Dify giả (`Bun.serve` cổng 0,
// kịch bản từng lời gọi, đếm + lưu `user`/`inputs`), workflow catalog fixture (owner SQL, secret mã hoá như H2a), công tắc
// tool (owner SQL), điều kiện tiền đề `needD2` (đỏ NGAY khi thiếu 0037/0012 hoặc contract P-d2 — Luật 4c). Chờ việc nền bằng
// `handles.settled()` (DrainTracker) + `*Once`, không ngủ chờ. Không chứa `it(...)`.

import { expect } from "bun:test";
import { type AddressInfo, createServer, type Socket } from "node:net";
import { encryptSecret, parseMasterKey } from "../../../../apps/admin-api/src/lib/secret-crypto";
import { TEST_MASTER_KEY_B64 } from "../../H2a/_h2a";
import { type CtxPd, type Json, noFeature, type Sql, startPd, T } from "../_support/pd";

const x = (n: number) => `a5d20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Workflow fixture (test-plan-d2 đầu file). */
export const WF = {
  W: { id: x(101), key: "xuat-hoa-don", side: false, enabled: true, file: false },
  WS: { id: x(102), key: "ghi-so", side: true, enabled: true, file: false },
  WOFF: { id: x(103), key: "tat-han", side: false, enabled: false, file: false },
  /** PD2-P03: 20 tham số number tuỳ chọn `p0…p19`. */
  W20: { id: x(104), key: "tham-so-20", side: false, enabled: true, file: false },
} as const;
export type WfName = keyof typeof WF;
const SEC = (i: number) => x(120 + i);
const P20 = Array.from({ length: 20 }, (_, i) => ({
  name: `p${i}`,
  type: "number",
  required: false,
  label: `P${i}`,
}));

// ---------- Dify giả ----------
export type Reply =
  | { kind: "json"; result: unknown }
  | { kind: "raw"; text: string }
  | { kind: "http"; status: number }
  | { kind: "hold"; until: Promise<void>; result: unknown };
export type FakeDify = {
  baseUrl: string;
  calls: { user: string; inputs: Json }[];
  script: (r: Reply[]) => void;
  /** T15b: chờ TÍN HIỆU lời gọi thứ `n` tới; `guard` xong trước mà chưa đủ ⇒ ném ngay (không đợi hết giờ). */
  arrived: (n: number, guard: () => Promise<void>) => Promise<void>;
  stop: () => Promise<void>;
};
/** `POST /v1/workflows/run` trả theo `script` (hết kịch bản ⇒ `{so_hd:"HD-1"}`), `outputs.result` = chuỗi JSON. */
export function startFakeDify(): FakeDify {
  let queue: Reply[] = [];
  const waiters: { n: number; ok: () => void }[] = [];
  const calls: FakeDify["calls"] = [];
  const wake = () => {
    for (const w of [...waiters]) {
      if (calls.length < w.n) continue;
      waiters.splice(waiters.indexOf(w), 1);
      w.ok();
    }
  };
  const out = (text: string) =>
    Response.json({ data: { status: "succeeded", outputs: { result: text } } });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== "/v1/workflows/run")
        return new Response("not found", { status: 404 });
      const body = (await req.json().catch(() => ({}))) as Json;
      calls.push({ user: body.user, inputs: body.inputs });
      wake();
      const r = queue.shift() ?? { kind: "json", result: { so_hd: "HD-1" } };
      if (r.kind === "http") return new Response("lỗi", { status: r.status });
      if (r.kind === "raw") return out(r.text);
      if (r.kind === "hold") await r.until;
      return out(JSON.stringify(r.result));
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    calls,
    script: (r) => {
      queue = [...r];
    },
    arrived: (n, guard) => {
      if (calls.length >= n) return Promise.resolve();
      const sig = new Promise<void>((ok) => waiters.push({ n, ok }));
      const fail = guard().then(() => {
        if (calls.length < n)
          throw new Error(`tool-driver xong mà Dify mới ${calls.length}/${n} lời gọi`);
      });
      return Promise.race([sig, fail]);
    },
    stop: async () => {
      await server.stop(true);
    },
  };
}

// ---------- Dify giả mức socket (T15b, PD2-I06/I06b, Q-D2-2) ----------
/** Giữ trước một cổng trống: bind cổng 0 rồi đóng ⇒ `127.0.0.1:<port>` từ chối kết nối (ECONNREFUSED) tới khi `listen`. */
export async function reservePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}
/** `close_before_body`: nhận kết nối rồi đóng socket ngay; `close_after_body`: đọc hết request rồi đóng (không trả gì);
 *  `ok`: trả 200 `{so_hd:"HD-1"}`. Mỗi kết nối tới được handler = 1 lời gọi (`calls`). */
export type NetMode = "ok" | "close_before_body" | "close_after_body";
export type NetDify = {
  port: number;
  baseUrl: string;
  calls: () => number;
  modes: (m: NetMode[]) => void;
  listen: () => Promise<void>;
  stop: () => Promise<void>;
};
function requestComplete(buf: Buffer): boolean {
  const i = buf.indexOf("\r\n\r\n");
  if (i < 0) return false;
  const head = buf.subarray(0, i).toString("latin1");
  if (/transfer-encoding:\s*chunked/i.test(head)) return buf.subarray(i + 4).includes("0\r\n\r\n");
  const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? 0);
  return buf.length >= i + 4 + len;
}
export function startNetDify(port: number): NetDify {
  let queue: NetMode[] = [];
  let n = 0;
  const socks = new Set<Socket>();
  const okBody = JSON.stringify({
    data: { status: "succeeded", outputs: { result: JSON.stringify({ so_hd: "HD-1" }) } },
  });
  const server = createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => undefined);
    n++;
    const m = queue.shift() ?? "ok";
    if (m === "close_before_body") return void sock.destroy();
    let buf = Buffer.alloc(0);
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (!requestComplete(buf)) return;
      if (m === "close_after_body") return void sock.destroy();
      sock.end(
        `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(okBody)}\r\nconnection: close\r\n\r\n${okBody}`,
      );
    });
  });
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    calls: () => n,
    modes: (m) => {
      queue = [...m];
    },
    listen: async () => {
      if (server.listening) return;
      await new Promise<void>((ok, bad) => {
        server.once("error", bad);
        server.listen(port, "127.0.0.1", () => ok());
      });
    },
    stop: async () => {
      for (const s of socks) s.destroy();
      if (server.listening) await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

// ---------- điều kiện tiền đề ----------
/** 0012 (`admin.tenant_workflow_tools`) + 0037 (`stage_runs.status='skipped'`) + contract `EXECUTOR_KINDS ∋ tool`. */
export async function needD2(c: CtxPd): Promise<void> {
  const [r] = await c.sql<{ tools: boolean; skipped: boolean }[]>`select
      to_regclass('admin.tenant_workflow_tools') is not null as tools,
      exists (select 1 from pg_constraint where conrelid = 'hub.stage_runs'::regclass
              and pg_get_constraintdef(oid) like '%skipped%') as skipped`;
  if (!r?.tools) noFeature("công tắc tool theo tenant (admin.tenant_workflow_tools)", "T18a");
  if (!r?.skipped) noFeature("stage_runs.status skipped (migration 0037)", "T17");
  const chat = (await import("@ai/contracts/chat")) as Json;
  if (!(chat.EXECUTOR_KINDS as string[]).includes("tool"))
    noFeature("executor kind tool (contract)", "T17");
}

// ---------- dựng ----------
export type CtxD2 = CtxPd & { dify: FakeDify };
/** `startPd` + Dify giả + deps Hub đủ để giải mã secret workflow (như H2a). */
export async function startD2(opts: { processRunsPerTenant?: number } = {}): Promise<CtxD2> {
  const dify = startFakeDify();
  const c = await startPd({
    ...(opts.processRunsPerTenant && { processRunsPerTenant: opts.processRunsPerTenant }),
    extraDeps: { secretMasterKey: TEST_MASTER_KEY_B64, difyTimeoutMaxS: 300 },
  });
  return { ...c, dify, stop: async () => (await c.stop(), await dify.stop()) };
}
/** Workflow W/WS/WOFF (input `tong_tien` number required, `ma_kh` text) trỏ `baseUrl`. Gọi SAU `needD2`. */
export async function insertWorkflows(sql: Sql, baseUrl: string): Promise<void> {
  const key = parseMasterKey(TEST_MASTER_KEY_B64);
  const inputs = [
    { name: "tong_tien", type: "number", required: true, label: "Tổng tiền" },
    { name: "ma_kh", type: "text", required: false, label: "Mã KH" },
  ];
  for (const [i, w] of Object.values(WF).entries()) {
    const s = encryptSecret(key, SEC(i), `app-${w.key}`);
    await sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4) values
      (${SEC(i)}, ${`PD2_SECRET_${i}`}, ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.iv)}, 1, 'key1')
      on conflict do nothing`;
    await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id,
        input_schema, output_field, enabled, side_effect) values
      (${w.id}, ${w.key}, ${`Tool ${w.key}`}, 'Workflow thử nghiệm cho P-d2.', 'workflow', ${baseUrl}, ${SEC(i)},
       ${sql.json((w.key === "tham-so-20" ? P20 : inputs) as never)}, 'result', ${w.enabled}, ${w.side})
      on conflict (id) do nothing`;
  }
}
/** Bật/tắt công tắc tool (owner SQL) + bump version cấu hình Hub. */
export async function setSwitch(
  sql: Sql,
  wf: WfName,
  tenantId: string,
  on: boolean,
): Promise<void> {
  await sql`insert into admin.tenant_workflow_tools (workflow_id, tenant_id, granted_at, revoked_at)
    values (${WF[wf].id}, ${tenantId}, now(), ${on ? null : new Date()})
    on conflict (workflow_id, tenant_id) do update set revoked_at = ${on ? null : new Date()}`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}
export const ACME = T.acme;
export const BETA = T.beta;

/** Stage `tool` (contract plan-contract §6). */
export function toolStage(o: Json = {}): Json {
  return {
    key: o.key ?? "s1",
    name: o.name ?? "Xuất HĐ",
    step: o.step ?? 1,
    executor: {
      kind: "tool",
      tool_key: o.tool_key ?? WF.W.key,
      args: o.args ?? {
        tong_tien: { from: "field", stage_key: "s0", field: "tong_tien" },
        ma_kh: { from: "input", key: "ma-kh" },
      },
    },
    instruction: "",
    output: {
      filename: `${o.key ?? "s1"}.md`,
      template: "",
      required_sections: [],
      fields: o.fields ?? [
        { key: "so_hd", type: "string", required: true },
        { key: "tong_tien", type: "number", required: false },
      ],
    },
    after: o.after ?? { kind: "auto" },
    real_action: o.real_action ?? false,
    answerer: { kind: "starter" },
    timeout_s: o.timeout_s ?? 30,
    token_budget: null,
  };
}
export const MA_KH_INPUT = [{ key: "ma-kh", type: "text", label: "Mã KH", required: true }];

/** Chờ mọi việc stage-driver/tool-driver đang bay xong — tín hiệu `handles.settled()` (DrainTracker, L12). */
export async function settled(c: CtxPd): Promise<void> {
  const h = c.hub.handles() as Json;
  expect({ settled: typeof h?.settled }).toEqual({ settled: "function" });
  await h.settled();
}
/** Đếm audit theo action của run. */
export async function auditsOf(sql: Sql, action: string, runId: string): Promise<Json[]> {
  return sql<Json[]>`select * from hub.audit_log where action = ${action}
    and (entity_id = ${runId} or details::text like ${`%${runId}%`}) order by created_at`;
}
