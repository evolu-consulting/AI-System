// HUB-FR-44 · HUB-FR-75 · HUB-FR-12 · hạ tầng test int H2c (test-plan H2c §2, §2.1, test-plan-int "Chung"): catalog file
// (`hoadon-file`, `anh-tuy-chon`, lệnh `/hoadon*`, `/sai-map`, `/file-arg`) bằng SQL owner; hub-api thật kèm
// `AppDeps.attachments = {storage: createLocalStorage({dir}), tenantMaxBytes, sweepS: 600, sweep: false}` (L1, L2, L8) với
// thư mục tạm riêng mỗi lần dựng (xoá ở `stop`); tải lên qua `fetch` (có/không `Content-Length`) và socket thô (L3);
// hàng `hub.attachments` giả (SQL owner) + nội dung ghi thẳng `<dir>/<tenant>/<id>` (AC-01). Không chứa `it(...)`.
// Dùng chung QW-A1 và QW-A2.
//
// Seam test ↔ hub-api (ghi cho backend-lead, test-plan H2c §2): `createApp(cfg, deps)` nhận dep **tuỳ chọn**
// `attachments?: {storage, tenantMaxBytes, sweepS, sweep?: boolean}` (plan §4 `config/env-deps`). B0 chưa có khoá này ở
// `AppDeps` ⇒ helper truyền qua `extra` (ép kiểu); `createLocalStorage` còn ném `not implemented` ⇒ hub dựng **không**
// `attachments` và ghi `storageError` (route `/attachments*` 404 — đỏ đúng lý do ở ca, không ở `beforeAll`).
import { expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttachmentNotFoundDetailsSchema,
  ErrorResponseSchema,
  FILENAME_HEADER,
} from "@ai/contracts/chat";
import { encryptSecret, parseMasterKey } from "../../../apps/admin-api/src/lib/secret-crypto";
import type { AttachmentStorage } from "../../../apps/hub-api/src/modules/attachments/storage";
import { createLocalStorage } from "../../../apps/hub-api/src/modules/attachments/storage.local";
import {
  type Hub,
  type Json,
  type Keys,
  type Res,
  type Sql,
  T,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import { AG, type HubX, openSse, type Sse } from "../H1/_hub";
import { FEAT, TEST_MASTER_KEY_B64, WF } from "../H2a/_h2a";
import { type H2bExtra, type SetupOpts, setupH2b, startHubH2b } from "../H2b/_h2b";

export const MiB = 1_048_576;
export const KiB = 1024;
export const MAX = 20 * MiB;
export const DAY_MS = 86_400_000;

// ---------- id cố định (dải `a2c0…`, test-plan H2c §2.1) ----------
const c = (n: number) => `a2c00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const WF3 = { hoadonFile: c(1), anhTuyChon: c(2) } as const;
const SEC3 = { hoadonFile: c(3), anhTuyChon: c(4) } as const;
export const CMD3 = {
  hoadon: c(11),
  hoadonAsync: c(12),
  saiMap: c(13),
  fileArg: c(14),
  hoadonTuy: c(15),
} as const;
export const HOADON_FILE_DESC = "Hoá đơn PDF";

// ---------- catalog H2c (SQL owner, sau `insertCatalog` H2a) ----------
const inp = (name: string, type: string, required: boolean, description = `Biến ${name}`) => ({
  name,
  type,
  required,
  description,
});
const arg = (name: string, o: Record<string, unknown> = {}) => ({
  name,
  description: { vi: `Tham số ${name}`, en: `Argument ${name}` },
  default: null,
  fallback: null,
  rest: false,
  ...o,
});
const ATTACH = { source: "attachment" } as const;
const NOTE_REST = [arg("note", { rest: true })];

/**
 * Workflow `hoadon-file` (`file` bắt buộc + `note`), `anh-tuy-chon` (`img` tuỳ chọn + `q` bắt buộc), key `mk-ok`; lệnh
 * `/hoadon` (sync), `/hoadon-async`, `/sai-map` (`q` ← attachment), `/file-arg` (`file` ← arg), `/hoadon-tuy` (feature
 * `translate`); agent `hoadon` ↔ `hoadon-file`, `create-trello-card`, `allowed_tools = [Read, Grep, Write]` (PL9).
 */
export async function insertH2cCatalog(sql: Sql, baseUrl: string): Promise<void> {
  const key = parseMasterKey(TEST_MASTER_KEY_B64);
  const wfs = [
    {
      id: WF3.hoadonFile,
      sec: SEC3.hoadonFile,
      k: "hoadon-file",
      inputs: [inp("file", "file", true, HOADON_FILE_DESC), inp("note", "text", false)],
    },
    {
      id: WF3.anhTuyChon,
      sec: SEC3.anhTuyChon,
      k: "anh-tuy-chon",
      inputs: [inp("img", "file", false, "Ảnh minh hoạ"), inp("q", "text", true)],
    },
  ];
  for (const [i, w] of wfs.entries()) {
    const s = encryptSecret(key, w.sec, "mk-ok~pad");
    await sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4) values
      (${w.sec}, ${`QW_H2C_SECRET_${i + 1}`}, ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.iv)}, 1, '~pad')`;
    await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id,
        input_schema, output_field, enabled) values
      (${w.id}, ${w.k}, ${`WFNAME-${w.k}-qc`}, ${`Workflow thử ${w.k} dùng trong kiểm thử H2c.`}, 'workflow',
       ${baseUrl}, ${w.sec}, ${sql.json(w.inputs as never)}, null, true)`;
  }
  const out = { field: "text", render: "markdown" };
  const cmds = [
    { id: CMD3.hoadon, name: "hoadon", mode: "sync", map: { file: ATTACH, note: noteArg() } },
    {
      id: CMD3.hoadonAsync,
      name: "hoadon-async",
      mode: "async",
      map: { file: ATTACH, note: noteArg() },
    },
    { id: CMD3.saiMap, name: "sai-map", mode: "sync", map: { file: ATTACH, note: ATTACH } },
    {
      id: CMD3.fileArg,
      name: "file-arg",
      mode: "sync",
      map: { file: { source: "arg", value: "note" } },
    },
    { id: CMD3.hoadonTuy, name: "hoadon-tuy", mode: "sync", map: { img: ATTACH, q: noteArg() } },
  ];
  for (const m of cmds) {
    const wf = m.name === "hoadon-tuy" ? WF3.anhTuyChon : WF3.hoadonFile;
    await sql`insert into admin.commands (id, name, aliases, description, workflow_id, args, input_map, output,
        mode, timeout_s, enabled) values
      (${m.id}, ${m.name}, ${sql.array([])}, ${sql.json({ vi: `Lệnh /${m.name}`, en: null })}, ${wf},
       ${sql.json(NOTE_REST as never)}, ${sql.json(m.map as never)}, ${sql.json(out)}, ${m.mode}, 30, true)`;
    await sql`insert into admin.command_names (name, command_id) values (${m.name}, ${m.id})`;
    await sql`insert into admin.feature_commands (feature_id, command_id) values (${FEAT.translate}, ${m.id})`;
  }
  await sql`insert into hub.agent_workflows (agent_id, workflow_id) values
    (${AG.hoadon}, ${WF3.hoadonFile}), (${AG.hoadon}, ${WF.trello}) on conflict do nothing`;
  await sql`update hub.agents set runtime_options = ${sql.json({ allowed_tools: ["Read", "Grep", "Write"] })}
    where id = ${AG.hoadon}`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}
const noteArg = () => ({ source: "arg", value: "note" });

/** `setupH2b` (+ catalog H2a/H2b) + catalog H2c khi có `catalogBaseUrl`. */
export async function setupH2c(o: SetupOpts = {}): Promise<Sql> {
  const sql = await setupH2b(o);
  if (o.catalogBaseUrl) await insertH2cCatalog(sql, o.catalogBaseUrl);
  return sql;
}

// ---------- hub-api thật + storage thư mục tạm ----------
export const DEFAULT_TENANT_MAX = 5_368_709_120;
export type H2cOpts = { tenantMaxBytes?: number; extra?: H2bExtra; attachments?: boolean };
export type HubC = HubX & {
  /** Thư mục `HUB_ATTACH_DIR` của hub này (tuyệt đối, riêng). */
  dir: string;
  storage: AttachmentStorage | null;
  /** Lỗi `createLocalStorage` (B0: `not implemented`) — ca dùng `expectStorage`. */
  storageError: string | null;
  port: number;
};

/** Thư mục tạm riêng (xoá bằng `rmDir`). */
export const tempDir = (tag: string): Promise<string> => mkdtemp(join(tmpdir(), `qc-h2c-${tag}-`));
export const rmDir = (dir: string) => rm(dir, { recursive: true, force: true });

/**
 * `startHubH2b` (`maxConcurrentRuns` 2) + `attachments` deps (vòng sweeper tắt — L1); `attachments: false` = khung
 * không deps file (A141). `stop()` dừng hub rồi xoá thư mục.
 */
export async function startHubH2c(k: Keys, o: H2cOpts = {}): Promise<HubC> {
  const dir = await tempDir("hub");
  let storage: AttachmentStorage | null = null;
  let storageError: string | null = null;
  if (o.attachments !== false) {
    try {
      storage = await createLocalStorage({ dir });
    } catch (e) {
      storageError = e instanceof Error ? e.message : String(e);
    }
  }
  const attachments = storage
    ? {
        storage,
        tenantMaxBytes: o.tenantMaxBytes ?? DEFAULT_TENANT_MAX,
        sweepS: 600,
        sweep: false,
      }
    : undefined;
  const extra = { instanceId: "qc-hub-h2c", ...o.extra, attachments } as H2bExtra;
  const hub = await startHubH2b(k, extra);
  const stop = hub.stop;
  return {
    ...hub,
    dir,
    storage,
    storageError,
    port: Number(new URL(hub.base).port),
    stop: async () => {
      await stop();
      await rmDir(dir);
    },
  };
}

/** Ca cần driver: lỗi dựng storage (B0 `not implemented`) thành lỗi `expect` có thông điệp. */
export function expectStorage(hub: HubC): AttachmentStorage {
  expect(hub.storageError).toBeNull();
  return hub.storage as AttachmentStorage;
}

// ---------- byte mẫu (sinh trong test, test-plan §1 "Dữ liệu") ----------
const enc = new TextEncoder();
function padded(head: Uint8Array, n: number, fill = 0x41): Uint8Array {
  const b = new Uint8Array(Math.max(n, head.length)).fill(fill);
  b.set(head, 0);
  return b;
}
const bytes = (...xs: number[]) => Uint8Array.from(xs);
/** Tổng đúng `n` byte (≥ chữ ký). Nhóm chữ: ASCII hợp lệ, `\n` mỗi 64 byte. */
export const sample = {
  pdf: (n = 1024) => padded(enc.encode("%PDF-1.4\n"), n),
  png: (n = 1024) => padded(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), n, 0),
  jpg: (n = 1024) => padded(bytes(0xff, 0xd8, 0xff, 0xe0), n, 0),
  docx: (n = 1024) => padded(bytes(0x50, 0x4b, 0x03, 0x04), n, 0),
  csv: (n = 1024) => padded(bytes(0xef, 0xbb, 0xbf, ...enc.encode("a,b\n1,2\n")), n, 0x31),
  txt: (n = 1024) => text(n),
  md: (n = 1024) => padded(enc.encode("# Tiêu đề\n"), n),
};
function text(n: number): Uint8Array {
  const b = new Uint8Array(n).fill(0x61);
  for (let i = 63; i < n; i += 64) b[i] = 0x0a;
  return b;
}
export const sha256 = (b: Uint8Array | Buffer): string =>
  createHash("sha256").update(b).digest("hex");
export const pct = (name: string): string => encodeURIComponent(name);

// ---------- tải lên ----------
export type UploadOpts = {
  /** Giá trị thô `X-Filename` (mặc định `pct(name)`); `null` = không gửi header. */
  rawName?: string | null;
  /** Stream không `Content-Length` (Transfer-Encoding: chunked). */
  chunked?: boolean;
  headers?: Record<string, string>;
};
/** POST `/attachments` (JWT `token`; rỗng = không gửi). */
export async function upload(
  hub: Hub,
  token: string,
  body: Uint8Array,
  name: string,
  o: UploadOpts = {},
): Promise<Res> {
  const h = new Headers(o.headers);
  if (token) h.set("authorization", `Bearer ${token}`);
  const raw = o.rawName === undefined ? pct(name) : o.rawName;
  if (raw !== null) h.set(FILENAME_HEADER, raw);
  if (!h.has("content-type")) h.set("content-type", "application/octet-stream");
  // Server có thể trả lỗi trước khi đọc hết thân ⇒ không để kết nối dở bị dùng lại cho request kế.
  // (Bun) `keepalive: false` — kết nối riêng cho mỗi lần tải.
  const payload = o.chunked ? chunkStream(body, 256 * KiB) : body;
  const res = await fetch(`${hub.base}/attachments`, {
    method: "POST",
    headers: h,
    body: payload as BodyInit,
    keepalive: false,
    signal: AbortSignal.timeout(20_000),
  });
  const textBody = await res.text();
  let json: Json;
  try {
    json = textBody ? JSON.parse(textBody) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text: textBody, json };
}
function chunkStream(b: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (i >= b.length) return ctl.close();
      ctl.enqueue(b.subarray(i, i + size));
      i += size;
    },
  });
}
/** Upload phải 201 → id. */
export async function uploadOk(hub: Hub, token: string, body: Uint8Array, name: string) {
  const r = await upload(hub, token, body, name);
  expect(r.status).toBe(201);
  return r.json?.id as string;
}

export type RawRes = { status: number; head: string; body: string; sentAtResponse: number };
export type RawBody =
  | { bytes: Uint8Array; closeAfter?: boolean }
  | {
      total: number;
      chunk: number;
      everyMs: number;
      /** Byte đầu (chữ ký) trước phần đệm `A`. */
      prefix?: Uint8Array;
      abortAfter?: number;
      /** Gọi (và chờ) sau mỗi khối đã gửi. */
      onChunk?: (sent: number) => Promise<void> | void;
    };
/**
 * Socket thô (L3): request line + `headers` (nguyên văn) rồi thân. `bytes` = gửi một lần; dạng còn lại = gửi chậm
 * `chunk` byte mỗi `everyMs` tới khi đủ `total`, nhận phản hồi, hoặc đạt `abortAfter` (huỷ kết nối). `status` 0 = không
 * có phản hồi (đã huỷ / đóng).
 */
export function rawUpload(
  port: number,
  headers: Record<string, string>,
  body: RawBody,
  path = "/attachments",
): Promise<RawRes> {
  return new Promise((resolve) => {
    const st = { buf: "", sent: 0, sentAtResponse: -1, done: false };
    const sock = connect({ host: "localhost", port });
    const finish = () => {
      if (st.done) return;
      st.done = true;
      sock.destroy();
      const [head = "", rest = ""] = splitHead(st.buf);
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(head);
      resolve({
        status: m ? Number(m[1]) : 0,
        head,
        body: rest,
        sentAtResponse: st.sentAtResponse,
      });
    };
    sock.on("data", (d) => {
      if (st.sentAtResponse < 0) st.sentAtResponse = st.sent;
      st.buf += d.toString("latin1");
      if (responseComplete(st.buf)) finish();
    });
    sock.on("error", () => finish());
    sock.on("close", () => finish());
    sock.setTimeout(30_000, () => finish());
    sock.on("connect", () => {
      const lines = [`POST ${path} HTTP/1.1`, `Host: localhost:${port}`];
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      sock.write(`${lines.join("\r\n")}\r\n\r\n`);
      const write = (b: Uint8Array) =>
        new Promise<void>((ok) => {
          if (st.done) return ok();
          sock.write(b, () => ok());
        });
      void sendBody(body, st, write, finish);
    });
  });
}
type RawState = { sent: number; sentAtResponse: number; done: boolean };
/** Gửi thân theo `RawBody` (một lần / chậm từng khối / huỷ giữa chừng). */
async function sendBody(
  body: RawBody,
  st: RawState,
  write: (b: Uint8Array) => Promise<void>,
  finish: () => void,
): Promise<void> {
  if ("bytes" in body) {
    await write(body.bytes);
    st.sent = body.bytes.length;
    if (body.closeAfter) setTimeout(finish, 2_000);
    return;
  }
  const chunk = new Uint8Array(body.chunk).fill(0x41);
  if (body.prefix) {
    await write(body.prefix);
    st.sent = body.prefix.length;
  }
  while (!st.done && st.sent < body.total) {
    if (body.abortAfter !== undefined && st.sent >= body.abortAfter) return finish();
    const n = Math.min(body.chunk, body.total - st.sent);
    await write(chunk.subarray(0, n));
    st.sent += n;
    await body.onChunk?.(st.sent);
    if (st.sentAtResponse < 0) await Bun.sleep(body.everyMs);
  }
}
/** `GET <path>` trên kết nối mới (không dùng lại pool của `fetch`) → status (0 = không phản hồi). */
export function rawGet(port: number, path = "/health"): Promise<number> {
  return new Promise((resolve) => {
    let buf = "";
    const sock = connect({ host: "localhost", port });
    const end = (st: number) => {
      sock.destroy();
      resolve(st);
    };
    sock.on("connect", () =>
      sock.write(`GET ${path} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`),
    );
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(buf);
      if (m) end(Number(m[1]));
    });
    sock.on("error", () => end(0));
    sock.setTimeout(10_000, () => end(0));
  });
}
const splitHead = (s: string): [string, string] => {
  const i = s.indexOf("\r\n\r\n");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 4)];
};
function responseComplete(s: string): boolean {
  const [head, rest] = splitHead(s);
  if (!s.includes("\r\n\r\n")) return false;
  const m = /content-length:\s*(\d+)/i.exec(head);
  return m ? Buffer.byteLength(rest, "latin1") >= Number(m[1]) : false;
}

// ---------- gửi tin có file (E12) ----------
/** E12 với `attachment_ids` (`ids` vắng = không khoá). */
export function sendWith(
  hub: Hub,
  token: string,
  conv: string,
  content: string,
  ids?: unknown,
  flowId?: string,
): Promise<Sse> {
  const body: Record<string, unknown> = { content };
  if (flowId) body.flow_id = flowId;
  if (ids !== undefined) body.attachment_ids = ids;
  return openSse(hub, "POST", `/conversations/${conv}/messages`, { token, body });
}

/** 404 `ATTACHMENT_NOT_FOUND{ids}` đúng contract (test-plan-int "404 AF"). */
export function expectAttachNotFound(r: { status: number; json: Json }, ids: string[]): void {
  const e = ErrorResponseSchema.safeParse(r.json);
  expect({ status: r.status, code: e.success ? e.data.error.code : r.json }).toEqual({
    status: 404,
    code: "ATTACHMENT_NOT_FOUND",
  });
  const d = AttachmentNotFoundDetailsSchema.safeParse(r.json?.error?.details);
  expect(d.success).toBe(true);
  expect(d.data?.ids).toEqual(ids);
}
/** `{status, code}` của thân lỗi (`undefined` khi không đúng `ErrorResponseSchema`). */
export function codeOf(r: { status: number; json: Json }): { status: number; code?: string } {
  const e = ErrorResponseSchema.safeParse(r.json);
  return { status: r.status, code: e.success ? e.data.error.code : undefined };
}

// ---------- đĩa ----------
/** Mọi file dưới `dir` (đệ quy), đường dẫn tương đối `/`, sắp xếp. */
export async function diskFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, rel: string) => {
    let ents: import("node:fs").Dirent[];
    try {
      ents = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(join(d, e.name), r);
      else out.push(r);
    }
  };
  await walk(dir, "");
  return out.sort();
}
export const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const KEY_RE = new RegExp(`^${UUID_RE}/${UUID_RE}$`);
export const parts = (files: string[]) => files.filter((f) => f.endsWith(".part"));
/** Ghi nội dung thẳng `<dir>/<tenant>/<id>` (hàng giả có file — AC-01 bố cục). */
export async function writeStored(dir: string, key: string, b: Uint8Array): Promise<void> {
  const [t = "", id = ""] = key.split("/");
  await mkdir(join(dir, t), { recursive: true });
  await writeFile(join(dir, t, id), b);
}
export const pathOf = (dir: string, key: string) => join(dir, ...key.split("/"));

// ---------- hàng `hub.attachments` (SQL owner) ----------
export type AttRow = {
  id?: string;
  who?: UserKey;
  origin?: "upload" | "output";
  jobId?: string | null;
  filename?: string;
  mime?: string;
  size?: number;
  /** Nội dung (ghi lên đĩa khi có `dir`); `size`/`sha256` lấy theo nội dung. */
  content?: Uint8Array;
  dir?: string;
  createdAgoMs?: number;
  purged?: boolean;
  bind?: {
    messageId: string;
    conversationId: string;
    flowId: string;
    position: number;
  };
  conversationId?: string | null;
  flowId?: string | null;
};
/** Chèn hàng giả (R14 cỡ lớn không file; có `dir` + `content` ⇒ ghi file). Trả `{id, key}`. */
export async function insertAttachmentRow(
  sql: Sql,
  o: AttRow = {},
): Promise<{ id: string; key: string }> {
  const row = attachmentValues(o);
  await sql`insert into hub.attachments ${sql(row as never)}`;
  if (o.dir && o.content) await writeStored(o.dir, row.storage_key, o.content);
  return { id: row.id, key: row.storage_key };
}
/** Giá trị cột cho `insertAttachmentRow` (mặc định: upload PDF 1 KiB chưa gắn của `lan`, vừa tạo). */
function attachmentValues(o: AttRow) {
  const u = USERS[o.who ?? "lan"];
  const id = o.id ?? crypto.randomUUID();
  const name = o.filename ?? `file-${id.slice(0, 8)}.pdf`;
  const created = new Date(Date.now() - (o.createdAgoMs ?? 0));
  return {
    id,
    tenant_id: u.tid,
    user_id: u.id,
    origin: o.origin ?? "upload",
    job_id: o.origin === "output" ? (o.jobId ?? crypto.randomUUID()) : null,
    ...bindValues(o, created),
    filename: name,
    safe_name: name,
    mime: o.mime ?? "application/pdf",
    size: o.content ? o.content.length : (o.size ?? 1024),
    sha256: o.content ? sha256(o.content) : "a".repeat(64),
    storage_key: `${u.tid}/${id}`,
    created_at: created,
    purged_at: o.purged ? new Date() : null,
  };
}
function bindValues(o: AttRow, created: Date) {
  const b = o.bind;
  return {
    conversation_id: b?.conversationId ?? o.conversationId ?? null,
    flow_id: b?.flowId ?? o.flowId ?? null,
    message_id: b?.messageId ?? null,
    position: b ? b.position : null,
    bound_at: b ? created : null,
  };
}

/** Hàng attachment (owner). */
export async function attRow(sql: Sql, id: string): Promise<Json> {
  const [r] = await sql`select * from hub.attachments where id = ${id}`;
  return r;
}
/** `counts()` H1 + `attachments` (test-plan-int "Chung"). */
export async function countsH2c(sql: Sql): Promise<Record<string, number>> {
  const [r] = await sql<Record<string, number>[]>`select
    (select count(*)::int from hub.messages) as messages,
    (select count(*)::int from hub.runs) as runs,
    (select count(*)::int from hub.jobs) as jobs,
    (select count(*)::int from hub.attachments) as attachments`;
  return r ?? {};
}
/** Lùi `created_at` (và `bound_at` nếu có) của hàng `ms`. */
export async function ageAttachment(sql: Sql, id: string, ms: number): Promise<void> {
  await sql`update hub.attachments set created_at = created_at - ${ms} * interval '1 millisecond',
    bound_at = bound_at - ${ms} * interval '1 millisecond' where id = ${id}`;
}
/** Tin user + id tin (owner) của flow, sắp tạo. */
export async function userMessages(sql: Sql, flowId: string): Promise<{ id: string }[]> {
  return sql<
    { id: string }[]
  >`select id from hub.messages where flow_id = ${flowId} and role = 'user'
    order by created_at, id`;
}
export const tenantOf = (who: UserKey) => USERS[who].tid;
export const ACME = T.acme;
