// HUB-FR-40 · HUB-FR-45 · luật thuần E5–E11 (C1 plan §2.3–§2.4): cursor keyset, mẫu tìm `q` không dấu, nhãn step,
// map dòng DB → thực thể contract chat. Không import I/O.
import {
  type Ask,
  AskSchema,
  type AttachMime,
  type AttachmentRef,
  type Conversation,
  foldVi,
  type Message,
  type Responder,
  type RunError,
  type RunSummary,
  type StepSummary,
} from "@ai/contracts/chat";

/** Khoá keyset = (thời điểm UTC đủ micro giây, id). Thời điểm là chuỗi để không mất độ chính xác µs của Postgres. */
export type PageKey = readonly [at: string, id: string];

const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cursor opaque = base64url(JSON `[at, id]`) của phần tử cuối trang trước. */
export function encodeCursor(key: PageKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

/** Cursor hỏng/lạ → null (route trả 400 `VALIDATION_ERROR`). Chỉ nhận đúng dạng do `encodeCursor` sinh. */
export function decodeCursor(raw: string): PageKey | null {
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [at, id] = v as unknown[];
  if (typeof at !== "string" || !AT_RE.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  return encodeCursor([at, id]) === raw ? [at, id] : null;
}

/** Lấy `limit` dòng đầu (repo đọc `limit + 1`); `next` = cursor dòng cuối trang khi còn dòng sau. */
export function takePage<T extends { key: PageKey }>(
  rows: readonly T[],
  limit: number,
): { items: T[]; next: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, next: rows.length > limit && last ? encodeCursor(last.key) : null };
}

/** Mẫu LIKE trên `title_norm` (đã `foldVi`): chứa `q`, không phân biệt hoa thường và dấu; thoát `\ % _`. */
export function titleSearchPattern(q: string): string {
  return `%${foldVi(q.trim()).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export type Locale = "vi" | "en";
export type StepType = "orchestrator" | "delegate" | "workflow" | "tool";

/**
 * Nhãn step tĩnh theo `runs.locale` (plan H1 §6.1; H2a `plan-errors` §3 cho `workflow`/`tool`), không lộ key
 * agent/provider/workflow (C1-R04, R09).
 */
const STEP_LABELS: Record<StepType, Record<Locale, string>> = {
  orchestrator: { vi: "Đang phân tích yêu cầu…", en: "Analyzing your request…" },
  delegate: { vi: "Đang xử lý…", en: "Working on it…" },
  workflow: { vi: "Đang chạy lệnh", en: "Running command" },
  tool: { vi: "Đang dùng công cụ", en: "Using a tool" },
};
export function stepLabel(type: StepType, locale: Locale): string {
  return STEP_LABELS[type][locale];
}

export type ConversationRow = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  flowCount: number;
};
export function toConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    title: r.title,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    flow_count: r.flowCount,
  };
}

export type StepRow = {
  runId: string;
  seq: number;
  type: StepType;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
};
export type RunRow = {
  id: string;
  status: string;
  locale: Locale;
  startedAt: Date;
  finishedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorHint: string | null;
  /** H2b P1 · `runs.responder_*` (chỉ run `direct`, chốt lúc tạo run); null ở run khác. */
  responder?: Responder | null;
};

const msBetween = (a: Date, b: Date | null): number =>
  b ? Math.max(0, b.getTime() - a.getTime()) : 0;

/** Step đã xong `ok`/`failed` → StepSummary; `running`/`skipped` không hiện (StepSummary chỉ có ok|failed). */
export function toStepSummaries(steps: readonly StepRow[], locale: Locale): StepSummary[] {
  return steps
    .filter((s) => s.status === "ok" || s.status === "failed")
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({
      step_id: `s${s.seq}`,
      label: stepLabel(s.type, locale),
      status: s.status as StepSummary["status"],
      ms: msBetween(s.startedAt, s.finishedAt),
    }));
}

/** Run đang chạy → null (chưa có tóm tắt). `error` chỉ khi failed/cancelled và có mã. */
export function toRunSummary(r: RunRow, steps: readonly StepRow[]): RunSummary | null {
  if (r.status !== "finished" && r.status !== "failed" && r.status !== "cancelled") return null;
  const error: RunError | null =
    r.status !== "finished" && r.errorCode
      ? {
          code: r.errorCode as RunError["code"],
          message: r.errorMessage ?? r.errorCode,
          hint: r.errorHint ?? "",
        }
      : null;
  if (r.status !== "finished" && !error) return null;
  return {
    id: r.id,
    status: r.status,
    ms: msBetween(r.startedAt, r.finishedAt),
    steps: toStepSummaries(steps, r.locale),
    error,
  };
}

export type MessageRow = {
  id: string;
  conversationId: string;
  flowId: string;
  role: "user" | "assistant";
  content: string;
  runId: string | null;
  ask: unknown;
  createdAt: Date;
};

/** Hàng `hub.attachments` của một tin (plan-db §2.6). */
export type AttachmentRefRow = {
  id: string;
  filename: string;
  mime: AttachMime;
  size: number;
  purgedAt: Date | null;
};

/** H2c-R12 · `available = purgedAt === null` (nội dung còn). */
export function toAttachmentRef(r: AttachmentRefRow): AttachmentRef {
  return {
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    available: r.purgedAt === null,
  };
}

/**
 * `ask` jsonb validate ở biên; sai dạng → null. Tin user không bao giờ có `run`/`ask`/`responder`. H2b P1/P2: `responder`
 * chỉ ở tin assistant của run `direct` — khoá **vắng** ở tin khác (không `null`). H2c-R12 (P2): `attachments` chỉ khi
 * `refs` ≥ 1 (thứ tự `position`), vắng khi không file.
 */
export function toMessage(
  m: MessageRow,
  run: RunSummary | null,
  responder?: Responder | null,
  refs?: readonly AttachmentRef[],
): Message {
  const isAssistant = m.role === "assistant";
  const ask = isAssistant ? AskSchema.safeParse(m.ask) : null;
  return {
    id: m.id,
    conversation_id: m.conversationId,
    flow_id: m.flowId,
    role: m.role,
    content: m.content,
    run_id: m.runId,
    created_at: m.createdAt.toISOString(),
    run: isAssistant ? run : null,
    ask: ask?.success ? (ask.data as Ask) : null,
    ...(isAssistant && responder ? { responder } : {}),
    ...(refs && refs.length > 0 ? { attachments: [...refs] } : {}),
  };
}
