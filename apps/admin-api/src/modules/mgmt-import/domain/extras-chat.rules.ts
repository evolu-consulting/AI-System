// niti-import2 · chat trợ lý mgmt-app (một bản ghi = cả hội thoại, `messages[]`) ⇒ hội thoại LƯU TRỮ của hub (conversation + một
// flow + messages, không run, không agent) thuộc user đích; file chat (`chat_files`, bytes `<org>/<id>/<tên>`) ⇒ đính kèm FileBox
// gắn vào lượt user nhắc tên file đó (≤ 10/lượt); file không lượt nào nhắc ⇒ hội thoại lưu trữ "Tệp đã tải lên ở app cũ". Id tất
// định theo (nhãn lô, loại, id cũ) ⇒ chạy lại không nhân đôi. Thời điểm tin tăng ngặt (tin cũ không có giờ ⇒ +1 ms). Thuần.
import type { SourceDoc } from "./context";
import { targetId } from "./ids.rules";
import { isObj, str, ts } from "./values.rules";

/** ≡ `ATTACH_ALLOWED` (@ai/contracts) — CHECK `attachments_mime_check` của hub. */
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  xml: "application/xml",
  json: "application/json",
};
const PER_MESSAGE = 10;
const ORPHAN_TITLE = "Tệp đã tải lên ở app cũ";

export type Row = Record<string, unknown>;
/** Một file chat cần đọc bytes (`dir` = `<org>/<id cũ>`) rồi thành hàng `hub.attachments`. */
export type ChatFileJob = { mgmtId: string; dir: string; row: Row };
/** Một tx: hội thoại + flow + tin + đính kèm. */
export type ConvUnit = {
  conv: Row;
  flow: Row;
  messages: Row[];
  files: ChatFileJob[];
  /** Hội thoại gom file không lượt nào nhắc (không phải chat cũ). */
  orphan?: true;
};
export type ChatPlan = {
  units: ConvUnit[];
  /** File có đuôi hub không nhận (không đính kèm được — tên vẫn ghi trong tin). */
  unsupported: string[];
  messages_skipped_empty: number;
};
type Ctx = { source: string; tenantId: string; userId: string; now: string };

/** ≡ `foldVi` (hub-api my-history.rules) — cột `title_norm` để ô tìm thanh bên khớp. */
export function foldVi(s: string): string {
  let out = "";
  for (const ch of s) {
    const f = ch
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase();
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

/** Tên an toàn ≤ 120 byte (≈ `safeName` của hub): ký tự lạ ⇒ `_`, giữ đuôi. */
export function safeName(name: string): string {
  const s = name.replace(/[^\p{L}\p{N} ._-]/gu, "_").replace(/_+/g, "_");
  const enc = new TextEncoder();
  if (enc.encode(s).length <= 120) return s || "file";
  const dot = s.lastIndexOf(".");
  const tail = dot > 0 && s.length - dot <= 11 ? s.slice(dot) : "";
  let body = [...s.slice(0, s.length - tail.length)];
  while (body.length && enc.encode(body.join("") + tail).length > 120) body = body.slice(0, -1);
  return body.join("") + tail || "file";
}

export const mimeOfName = (name: string): string | null =>
  MIME[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? null;

const plus = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
const later = (a: string, b: string) => (a > b ? a : b);

function fileRow(
  c: Ctx,
  f: SourceDoc,
  at: { conv: string; flow: string; msg: string; pos: number; t: string },
) {
  const name = str(f.src.name, 200) ?? "file";
  const id = targetId(c.source, "attach", f.id);
  return {
    mgmtId: f.id,
    dir: `${str(f.src.org_id, 128) ?? ""}/${f.id}`,
    row: {
      id,
      filename: name,
      safe_name: safeName(name),
      mime: mimeOfName(name),
      conversation_id: at.conv,
      flow_id: at.flow,
      message_id: at.msg,
      position: at.pos,
      created_at: ts(f.src.created_at) ?? at.t,
      bound_at: at.t,
    },
  } satisfies ChatFileJob;
}

type Pool = { byName: Map<string, SourceDoc[]>; used: Set<string> };

/** File của lượt user (`files: [tên]`) ⇒ file chat cùng tên chưa dùng. */
function take(pool: Pool, names: unknown): SourceDoc[] {
  const out: SourceDoc[] = [];
  for (const n of Array.isArray(names) ? names : []) {
    const f = (pool.byName.get(String(n)) ?? []).find((x) => !pool.used.has(x.id));
    if (f && out.length < PER_MESSAGE) {
      pool.used.add(f.id);
      out.push(f);
    }
  }
  return out;
}

/** Tin hợp lệ (vai user/assistant, nội dung khác rỗng) hoặc null. */
function msgOf(
  m: unknown,
): { role: string; content: string; at: string | null; files: unknown } | null {
  if (!isObj(m) || (m.role !== "user" && m.role !== "assistant")) return null;
  const content = str(m.content, 100_000);
  return content ? { role: m.role, content, at: ts(m.at), files: m.files } : null;
}

function chatUnit(c: Ctx, d: SourceDoc, pool: Pool, plan: ChatPlan): ConvUnit | null {
  const conv = targetId(c.source, "conv", d.id);
  const flow = targetId(c.source, "flow", d.id);
  const base = ts(d.src.created_at) ?? ts(d.src.updated_at) ?? c.now;
  let t = plus(base, -1);
  const messages: Row[] = [];
  const files: ChatFileJob[] = [];
  const raw = Array.isArray(d.src.messages) ? d.src.messages : [];
  for (const [i, x] of raw.entries()) {
    const m = msgOf(x);
    if (!m) {
      plan.messages_skipped_empty++;
      continue;
    }
    t = later(m.at ?? plus(t, 1), plus(t, 1));
    const id = targetId(c.source, "msg", `${d.id}#${i}`);
    messages.push({
      id,
      conversation_id: conv,
      flow_id: flow,
      role: m.role,
      content: m.content,
      created_at: t,
    });
    const mine = m.role === "user" ? take(pool, m.files) : [];
    for (const [pos, f] of mine.entries())
      files.push(fileRow(c, f, { conv, flow, msg: id, pos, t }));
  }
  if (messages.length === 0) return null;
  const firstUser = messages.find((m) => m.role === "user")?.content as string | undefined;
  const title = str(d.src.title, 200) ?? str(firstUser, 200) ?? "Hội thoại cũ";
  return {
    conv: {
      id: conv,
      title,
      title_norm: foldVi(title),
      created_at: base,
      updated_at: t,
      archived_at: ts(d.src.archived_at) ?? t,
    },
    flow: {
      id: flow,
      conversation_id: conv,
      title,
      message_count: messages.length,
      created_at: base,
      last_active_at: t,
    },
    messages,
    files,
  };
}

/** File không lượt nào nhắc ⇒ một hội thoại lưu trữ, mỗi tin trợ lý liệt kê ≤ 10 file (đính kèm theo tin). */
function orphanUnit(c: Ctx, left: SourceDoc[]): ConvUnit | null {
  if (left.length === 0) return null;
  const conv = targetId(c.source, "conv", "__chat_files__");
  const flow = targetId(c.source, "flow", "__chat_files__");
  const sorted = [...left].sort(
    (a, b) =>
      String(ts(a.src.created_at) ?? "").localeCompare(String(ts(b.src.created_at) ?? "")) ||
      a.id.localeCompare(b.id),
  );
  const messages: Row[] = [];
  const files: ChatFileJob[] = [];
  let t = plus(ts(sorted[0]?.src.created_at) ?? c.now, -1);
  for (let i = 0; i < sorted.length; i += PER_MESSAGE) {
    const chunk = sorted.slice(i, i + PER_MESSAGE);
    t = later(ts(chunk[chunk.length - 1]?.src.created_at) ?? plus(t, 1), plus(t, 1));
    const id = targetId(c.source, "msg", `__chat_files__#${i / PER_MESSAGE}`);
    const names = chunk.map((f) => str(f.src.name, 200) ?? "file").join(", ");
    messages.push({
      id,
      conversation_id: conv,
      flow_id: flow,
      role: "assistant",
      content: `${ORPHAN_TITLE}: ${names}`,
      created_at: t,
    });
    for (const [pos, f] of chunk.entries())
      files.push(fileRow(c, f, { conv, flow, msg: id, pos, t }));
  }
  const base = messages[0]?.created_at as string;
  return {
    conv: {
      id: conv,
      title: ORPHAN_TITLE,
      title_norm: foldVi(ORPHAN_TITLE),
      created_at: base,
      updated_at: t,
      archived_at: t,
    },
    flow: {
      id: flow,
      conversation_id: conv,
      title: ORPHAN_TITLE,
      message_count: messages.length,
      created_at: base,
      last_active_at: t,
    },
    messages,
    files,
    orphan: true,
  };
}

export function planChats(c: Ctx, chats: SourceDoc[], chatFiles: SourceDoc[]): ChatPlan {
  const plan: ChatPlan = { units: [], unsupported: [], messages_skipped_empty: 0 };
  const pool: Pool = { byName: new Map(), used: new Set() };
  for (const f of chatFiles) {
    const n = String(f.src.name ?? "");
    pool.byName.set(n, [...(pool.byName.get(n) ?? []), f]);
  }
  for (const d of chats) {
    const u = chatUnit(c, d, pool, plan);
    if (u) plan.units.push(u);
  }
  const orphan = orphanUnit(
    c,
    chatFiles.filter((f) => !pool.used.has(f.id)),
  );
  if (orphan) plan.units.push(orphan);
  for (const u of plan.units) {
    const ok = u.files.filter((j) => j.row.mime !== null);
    for (const j of u.files) if (j.row.mime === null) plan.unsupported.push(String(j.row.filename));
    u.files = ok;
  }
  return plan;
}
