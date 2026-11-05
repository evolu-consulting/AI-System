// CR-120 · cr120-community-flows · use case 3 khe Community (route REST + `FlowSlotAdapter` dùng CHUNG ⇒ một luật). Mỗi hàm MỘT
// tx gói (RLS người xem). Người duyệt = Admin chủ quản (`tenant_admin` hoặc Group `community-admin`); đối tác KHÔNG BAO GIỜ duyệt.
// Agent (`screen`/`triage`) chạy NỀN sau commit, tx hệ thống riêng; lỗi/hết hạn/sai hình ⇒ vào duyệt (không tự đăng).

import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import type { PackSystemUow, PackUow, PackWho } from "../../kit/application/ports";
import {
  AGENT_SCREEN,
  AGENT_TRIAGE,
  afterScreen,
  type DecideError,
  parseScreen,
  parseTriage,
  decideJoin as ruleJoin,
  decideModeration as ruleMod,
  decideReport as ruleReport,
  screenPrompt,
  triagePrompt,
} from "../domain/flow.rules";
import type { Access } from "./community-access";
import * as repo from "./flows.repo";
import { upsertPartner } from "./org.repo";

type Uow = PackUow<{ tx: Tx }>;
type Sys = PackSystemUow<{ tx: Tx }>;

/** Cổng agent tối thiểu (khớp `AgentCaller.call` của `lib/ai-client/agent-call`). */
export type FlowAgents = {
  call(req: {
    tenantId: string;
    userId: string | null;
    agentKey: string;
    feature: string;
    app: string;
    prompt: string;
    signal: AbortSignal;
  }): Promise<{ ok: true; text: string } | { ok: false; code: string }>;
};

export type FlowDeps = {
  uow: Uow;
  sys: Sys;
  agents?: FlowAgents | undefined;
  /** Khe duyệt bài có def cho tenant (gán/luật riêng) ⇒ bài mới vào duyệt; vắng ⇒ tắt. */
  moderationOn?: ((tenantId: string) => Promise<boolean>) | undefined;
  /** Seam test: nhận promise việc nền (await để chờ xong, không ngủ). */
  background?: ((p: Promise<unknown>) => void) | undefined;
  /** Bài được duyệt (tự động hoặc tay) ⇒ phát chuông bài mới. */
  onApproved?: ((row: repo.ModPostRow, tenantId: string) => Promise<void>) | undefined;
  agentTimeoutMs?: number;
  now?: () => number;
  warn?: (m: string, meta: Record<string, unknown>) => void;
};

export const reviewer = (a: Access): boolean => a.org === null && a.isAdmin;
export type DecideBody = {
  taskId?: string | undefined;
  action: string;
  feedback?: string | undefined;
};
const nowOf = (d: FlowDeps) => (d.now ? d.now() : Date.now());

const STATUS: Record<DecideError, 403 | 409 | 422> = {
  NOT_OPEN: 409,
  NOT_REVIEWER: 403,
  ACTION_UNKNOWN: 422,
};
export class FlowDecideError extends AppError {
  constructor(readonly reason: DecideError | "TASK_STALE") {
    const status = reason === "TASK_STALE" ? 409 : STATUS[reason];
    const code =
      reason === "TASK_STALE" || reason === "NOT_OPEN"
        ? "FLOW_TASK_NOT_OPEN"
        : reason === "NOT_REVIEWER"
          ? "FLOW_NOT_REVIEWER"
          : "FLOW_ACTION_UNKNOWN";
    super(code, status, code);
  }
}

function runBg(d: FlowDeps, p: Promise<unknown>): void {
  const safe = p.catch((e: unknown) => d.warn?.("community-flow-bg-failed", { err: String(e) }));
  d.background?.(safe);
}

async function agentText(d: FlowDeps, who: PackWho, key: string, prompt: string, subject: string) {
  if (!d.agents) return null;
  try {
    const out = await d.agents.call({
      tenantId: who.tenantId,
      userId: who.userId,
      agentKey: key,
      feature: `community.${key}`,
      app: "community",
      prompt,
      signal: AbortSignal.timeout(d.agentTimeoutMs ?? 30_000),
    });
    return out.ok ? out.text : null;
  } catch (e) {
    d.warn?.("community-agent-failed", { key, subject, err: String(e) });
    return null;
  }
}

// ---------------------------------------------------------------- post-moderation
/** Khe duyệt bài bật cho tenant? Gọi TRƯỚC khi mở tx tạo bài (không giữ tx gói khi hỏi hub). */
export const moderationEnabled = async (d: FlowDeps | undefined, tenantId: string) =>
  !!d?.moderationOn && (await d.moderationOn(tenantId));

/** Trong tx tạo bài: mở lượt (bài ẩn với người khác tới khi duyệt). */
export const openModeration = (tx: Tx, postId: string) => repo.openModeration(tx, postId);

/** Sửa nội dung bài đã qua duyệt (approved/rejected/none) ⇒ mở lại lượt trong tx sửa. true = đã mở lại (cần chạy lại screen sau commit). */
export const reopenModeration = async (tx: Tx, postId: string): Promise<boolean> =>
  (await repo.reopenModeration(tx, postId)) === 1;

/** Việc nền: agent `screen` ⇒ ghi kết quả (tx hệ thống). Sạch ⇒ approved + chuông bài mới. */
export async function screenPost(d: FlowDeps, who: PackWho, postId: string): Promise<void> {
  const [row] = await d.sys.system(who.tenantId, ({ tx }) => repo.modRows(tx, [postId]));
  // task đọc CÙNG lúc với nội dung gửi agent ⇒ kết quả chỉ áp cho đúng lượt này (sửa bài giữa chừng ⇒ task đổi ⇒ bỏ)
  if (!row || row.moderation !== "pending" || !row.mod_task_id) return;
  const taskId = row.mod_task_id;
  const text = await agentText(d, who, AGENT_SCREEN, screenPrompt(row), postId);
  const res = text === null ? null : parseScreen(text);
  const next = afterScreen(res);
  const n = await d.sys.system(who.tenantId, ({ tx }) =>
    repo.applyScreen(tx, postId, taskId, { ...next, reason: res?.reason ?? null }),
  );
  if (n === 1 && next.moderation === "approved") await d.onApproved?.(row, who.tenantId);
}

export function startScreen(d: FlowDeps, who: PackWho, postId: string): void {
  runBg(d, screenPost(d, who, postId));
}

export const modRows = (d: FlowDeps, a: Access, ids: readonly string[]) =>
  a.org === null || ids.length === 0
    ? d.uow.tenant(a.who, ({ tx }) => repo.modRows(tx, ids))
    : Promise.resolve([]);

export const modQueue = (d: FlowDeps, a: Access) => {
  if (!reviewer(a)) throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
  return d.uow.tenant(a.who, ({ tx }) => repo.modQueue(tx, 100));
};

export const myModeration = (d: FlowDeps, a: Access) =>
  d.uow.tenant(a.who, ({ tx }) => repo.myModeration(tx, a.who.userId, 50));

export async function decideModeration(
  d: FlowDeps,
  a: Access,
  id: string,
  b: { taskId?: string | undefined; action: string; feedback?: string | undefined },
): Promise<repo.ModPostRow> {
  const out = await d.uow.tenant(a.who, async ({ tx }) => {
    const [cur] = await repo.modRows(tx, [id]);
    if (!cur) throw appError("NOT_FOUND");
    const next = ruleMod(cur, b.action, { reviewer: reviewer(a), now: nowOf(d) });
    if (next === "NOT_OPEN" || next === "NOT_REVIEWER" || next === "ACTION_UNKNOWN")
      throw new FlowDecideError(next);
    const taskId = b.taskId ?? cur.mod_task_id;
    if (!taskId || taskId !== cur.mod_task_id) throw new FlowDecideError("TASK_STALE");
    const n = await repo.decideModeration(tx, {
      id,
      taskId,
      next,
      by: a.who.userId,
      name: a.dir.userName,
      feedback: b.feedback ?? null,
    });
    if (n !== 1) throw new FlowDecideError("TASK_STALE");
    const [row] = await repo.modRows(tx, [id]);
    return row as repo.ModPostRow;
  });
  if (out.moderation === "approved") await d.onApproved?.(out, a.who.tenantId);
  return out;
}

// ---------------------------------------------------------------- partner-join
export type JoinInput = {
  company: string;
  contact: string;
  email: string;
  reason: string;
  labels: ("supplier" | "buyer")[];
};

/** Đối tác (người xin) gửi form; host ⇒ 403; đang có yêu cầu chờ của công ty ⇒ 409. */
export async function createJoin(d: FlowDeps, a: Access, input: JoinInput): Promise<repo.JoinRow> {
  if (a.org === null) throw new AppError("JOIN_HOST_NOT_ALLOWED", 403, "Hosts are already members");
  const org = a.org;
  try {
    return await d.uow.tenant(a.who, async ({ tx }) => {
      const id = await repo.insertJoin(tx, {
        tenantId: a.who.tenantId,
        userId: a.who.userId,
        org,
        ...input,
      });
      const [row] = await repo.joinRows(tx, [id]);
      return row as repo.JoinRow;
    });
  } catch (e) {
    if (pgUnique(e)) throw new AppError("JOIN_PENDING_EXISTS", 409, "A request is already pending");
    throw e;
  }
}

export const joinRows = (d: FlowDeps, a: Access, ids: readonly string[]) =>
  ids.length === 0 ? Promise.resolve([]) : d.uow.tenant(a.who, ({ tx }) => repo.joinRows(tx, ids));

export const joinList = (d: FlowDeps, a: Access, pendingOnly: boolean) => {
  if (a.org === null && !reviewer(a)) throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
  return d.uow.tenant(a.who, ({ tx }) => repo.joinList(tx, pendingOnly, 100));
};

/** Tenant admin quyết; duyệt ⇒ liên kết công ty đối tác (nhãn xin) trong CÙNG tx. */
export async function decideJoin(
  d: FlowDeps,
  a: Access,
  id: string,
  b: { taskId?: string | undefined; action: string; feedback?: string | undefined },
): Promise<repo.JoinRow> {
  return d.uow.tenant(a.who, async ({ tx }) => {
    const [cur] = await repo.joinRows(tx, [id]);
    if (!cur) throw appError("NOT_FOUND");
    const next = ruleJoin(cur.status, b.action, { reviewer: reviewer(a) });
    if (next !== "approved" && next !== "rejected") throw new FlowDecideError(next);
    const taskId = b.taskId ?? cur.task_id;
    if (taskId !== cur.task_id) throw new FlowDecideError("TASK_STALE");
    const row = await repo.decideJoin(tx, {
      id,
      taskId,
      next,
      by: a.who.userId,
      name: a.dir.userName,
      feedback: b.feedback ?? null,
    });
    if (!row) throw new FlowDecideError("TASK_STALE");
    if (next === "approved")
      await upsertPartner(tx, a.who, row.requester_org, {
        labels: row.labels,
        cats: [],
        area: "",
        partyKey: null,
      });
    return row;
  });
}

// ---------------------------------------------------------------- report
/** Báo cáo bài mình thấy; trùng ⇒ 409; bài không thấy ⇒ 404. Triage chạy nền. */
export async function createReport(
  d: FlowDeps,
  a: Access,
  postId: string,
  reason: string,
): Promise<repo.ReportRow> {
  const row = await d.uow.tenant(a.who, async ({ tx }) => {
    const [post] = await repo.modRows(tx, [postId]);
    if (!post) throw appError("NOT_FOUND");
    const id = await repo.insertReport(tx, {
      tenantId: a.who.tenantId,
      postId,
      userId: a.who.userId,
      org: a.org,
      reason,
    });
    if (!id) throw new AppError("REPORT_DUPLICATE", 409, "Already reported");
    const [r] = await repo.reportRows(tx, [id]);
    return r as repo.ReportRow;
  });
  runBg(d, triageReport(d, a.who, row.id));
  return row;
}

export async function triageReport(d: FlowDeps, who: PackWho, id: string): Promise<void> {
  const ctx = await d.sys.system(who.tenantId, async ({ tx }) => {
    const [r] = await repo.reportRows(tx, [id]);
    const [p] = r ? await repo.modRows(tx, [r.post_id]) : [];
    return r && p ? { r, p } : null;
  });
  if (!ctx) return;
  const text = await agentText(
    d,
    who,
    AGENT_TRIAGE,
    triagePrompt({ reason: ctx.r.reason, title: ctx.p.title, body: ctx.p.body }),
    id,
  );
  const t = text === null ? null : parseTriage(text);
  await d.sys.system(who.tenantId, ({ tx }) => repo.applyTriage(tx, id, t));
}

export const reportRows = (d: FlowDeps, a: Access, ids: readonly string[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : d.uow.tenant(a.who, ({ tx }) => repo.reportRows(tx, ids));

/** Chủ quản không phải admin ⇒ 403 (RLS cho chủ quản thấy mọi báo cáo ⇒ chặn ở đây); đối tác: chỉ báo cáo của mình (RLS). */
export const reportList = (d: FlowDeps, a: Access, pendingOnly: boolean) => {
  if (a.org === null && !reviewer(a)) throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
  return d.uow.tenant(a.who, ({ tx }) => repo.reportList(tx, pendingOnly, 100));
};

export async function decideReport(
  d: FlowDeps,
  a: Access,
  id: string,
  b: { taskId?: string | undefined; action: string; feedback?: string | undefined },
): Promise<repo.ReportRow> {
  return d.uow.tenant(a.who, async ({ tx }) => {
    const [cur] = await repo.reportRows(tx, [id]);
    if (!cur) throw appError("NOT_FOUND");
    const act = ruleReport(cur.status, b.action, { reviewer: reviewer(a) });
    if (act !== "hide" && act !== "warn" && act !== "dismiss") throw new FlowDecideError(act);
    const taskId = b.taskId ?? cur.task_id;
    if (taskId !== cur.task_id) throw new FlowDecideError("TASK_STALE");
    const row = await repo.decideReport(tx, {
      id,
      taskId,
      action: act,
      by: a.who.userId,
      name: a.dir.userName,
      feedback: b.feedback ?? null,
    });
    if (!row) throw new FlowDecideError("TASK_STALE");
    return row;
  });
}

/** 23505 (unique) — postgres.js ném lỗi có `code`; drizzle bọc ở `cause`. */
function pgUnique(e: unknown): boolean {
  const c = (x: unknown) =>
    x && typeof x === "object" && "code" in x ? (x as { code: unknown }).code : null;
  return c(e) === "23505" || c((e as { cause?: unknown })?.cause) === "23505";
}
