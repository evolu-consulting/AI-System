// HUB-FR-112 · D12 · PF3 · nghiệp vụ `/me/review-tasks`, `/me/process-inbox`, `/me/process-inbox/read` (plan §5, §11;
// plan-contract §3 PF3, §7 `loadTaskDetails`). Đọc dưới `withHubScope(user)`; `TaskDetail` + `can_act` qua `loadTaskDetails`
// (B0) — không tự dựng. Người xem chỉ thấy task gán cho mình/Group mình (readiness #22).
import {
  OPEN_TASKS_COUNT_MAX,
  PROCESS_SYSTEM_SENDER,
  type ProcessInboxResponse,
  type ProcessNotice,
  type ReviewTaskListResponse,
  type TaskResult,
  type UserRef,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { validationError } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { loadTaskDetails, type ViewerCtx } from "../core/task-view";
import {
  type Cursor,
  listNotices,
  listTaskPage,
  markNoticesRead,
  type NoticeRow,
  noticeOwned,
  openTaskCount,
  type TaskPageRow,
  unreadNoticeCount,
} from "./inbox.repo";

type Scope = { kind: "user"; tenantId: string; userId: string };
const scopeOf = (u: AuthUser): Scope => ({
  kind: "user",
  tenantId: u.tenantId,
  userId: u.userId,
});
const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

// Cursor mờ = base64url(JSON [iso, id]); dạng lạ ⇒ 400 (như `GET /rooms`).
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString("base64url");
}
function parseCursor(s: string | undefined): Cursor | undefined {
  if (s === undefined) return undefined;
  const bad = () =>
    validationError([{ path: ["cursor"], code: "custom", message: "Invalid cursor" }]);
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    throw bad();
  }
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    typeof raw[0] !== "string" ||
    typeof raw[1] !== "string"
  )
    throw bad();
  const [iso, id] = raw as [string, string];
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== iso) throw bad();
  return { at, id };
}

async function viewerCtx(d: ProcessDeps, u: AuthUser): Promise<ViewerCtx> {
  const us = await d.config.user(u.userId);
  return {
    userId: u.userId,
    tenantId: u.tenantId,
    role: u.role,
    groupIds: us?.groupIds ?? new Set<string>(),
  };
}

const startedByRef = (r: TaskPageRow): UserRef => ({
  id: r.started_by,
  display_name: r.sb_display || r.sb_username || r.started_by,
});

/** `GET /me/review-tasks` — task của tôi (open/closed), `open_count` mọi task mở không phụ thuộc `status`. */
export function listReviewTasks(
  d: ProcessDeps,
  u: AuthUser,
  q: { status: "open" | "closed"; limit: number; cursor?: string },
): Promise<ReviewTaskListResponse> {
  const cursor = parseCursor(q.cursor);
  return withHubScope(d.db, scopeOf(u), async (tx: Tx) => {
    const v = await viewerCtx(d, u);
    const rows = await listTaskPage(tx, v, { status: q.status, limit: q.limit, cursor });
    const page = rows.slice(0, q.limit);
    const more = rows.length > q.limit;
    const details = await loadTaskDetails(
      tx,
      v,
      page.map((r) => r.task_id),
    );
    const byId = new Map(details.map((dt) => [dt.id, dt]));
    const open_count = await openTaskCount(tx, v, OPEN_TASKS_COUNT_MAX);
    const items = page.flatMap((r) => {
      const task = byId.get(r.task_id);
      return task
        ? [
            {
              task,
              process_run: {
                id: r.run_id,
                process: { key: r.proc_key, name: r.proc_name },
                status: r.run_status,
                started_by: startedByRef(r),
              },
            },
          ]
        : [];
    });
    const last = page.at(-1);
    return {
      items,
      open_count,
      next_cursor: more && last ? encodeCursor(toDate(last.created_at), last.task_id) : null,
    };
  });
}

function toNotice(r: NoticeRow): ProcessNotice {
  const p = r.payload ?? {};
  const result = p.result as TaskResult | undefined;
  return {
    id: r.id,
    kind: r.kind,
    process_run_id: r.process_run_id,
    task_id: r.task_id,
    process_name: typeof p.process_name === "string" ? p.process_name : "",
    stage_name: typeof p.stage_name === "string" ? p.stage_name : null,
    ...(result ? { result } : {}),
    created_at: toDate(r.created_at).toISOString(),
    read: r.read_at !== null,
  };
}

/** `GET /me/process-inbox` — DM "Quy trình" (D12): người gửi ảo cố định + danh sách notice + `unread`. */
export function listInbox(
  d: ProcessDeps,
  u: AuthUser,
  q: { limit: number; cursor?: string },
): Promise<ProcessInboxResponse> {
  const cursor = parseCursor(q.cursor);
  return withHubScope(d.db, scopeOf(u), async (tx: Tx) => {
    const rows = await listNotices(tx, u, { limit: q.limit, cursor });
    const page = rows.slice(0, q.limit);
    const more = rows.length > q.limit;
    const unread = await unreadNoticeCount(tx, u.userId, u.tenantId);
    const last = page.at(-1);
    return {
      sender: PROCESS_SYSTEM_SENDER,
      items: page.map(toNotice),
      unread,
      next_cursor: more && last ? encodeCursor(toDate(last.created_at), last.id) : null,
    };
  });
}

/** `POST /me/process-inbox/read` — đọc tới `up_to_id` (của tôi; else 404). */
export function markInboxRead(
  d: ProcessDeps,
  u: AuthUser,
  upToId: string,
): Promise<{ unread: number }> {
  return withHubScope(d.db, scopeOf(u), async (tx: Tx) => {
    if (!(await noticeOwned(tx, u.userId, u.tenantId, upToId))) throw appError("NOT_FOUND");
    await markNoticesRead(tx, u.userId, u.tenantId, upToId, d.now());
    return { unread: await unreadNoticeCount(tx, u.userId, u.tenantId) };
  });
}
