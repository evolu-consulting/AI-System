// CR-121 · R-3 · trang "Chi tiết lượt chạy" (admin): luật thuần — trạng thái bước → kiểu node sơ đồ; nút nào hiện theo trạng thái + vai.
// Khớp luật server `run-control.rules.ts` (server vẫn là nơi quyết định cuối; UI chỉ ẩn nút vô nghĩa).
import type { RunControlReason, RunStepState } from "@ai/contracts/chat";
import { ApiError } from "@/lib/http";

export type NodeTone = "ok" | "err" | "run" | "wait" | "off" | "dim";
export type NodeKind = {
  tone: NodeTone;
  /** Viền nhấp nháy (`acc` đang chạy · `warn` cần quyết định). */
  pulse: "acc" | "warn" | null;
  /** Hạt sáng chạy trên đoạn nối TỚI node này. */
  particle: boolean;
  /** Trạng thái đã/đang tới (đoạn nối phía trước được tô màu). */
  reached: boolean;
};

const KINDS: Record<RunStepState, NodeKind> = {
  done: { tone: "ok", pulse: null, particle: false, reached: true },
  running: { tone: "run", pulse: "acc", particle: true, reached: true },
  error: { tone: "err", pulse: null, particle: false, reached: true },
  needs_decision: { tone: "wait", pulse: "warn", particle: false, reached: true },
  skipped: { tone: "off", pulse: null, particle: false, reached: true },
  not_reached: { tone: "dim", pulse: null, particle: false, reached: false },
  cancelled: { tone: "off", pulse: null, particle: false, reached: false },
};

export const nodeKindOf = (s: RunStepState): NodeKind => KINDS[s];

const TERMINAL = new Set(["done", "failed", "cancelled", "expired"]);
export const isRunEnded = (status: string): boolean => TERMINAL.has(status);

export type ControlRole = "platform_admin" | "tenant_admin" | "member" | undefined;

export type RunControls = { canStop: boolean; canRerun: boolean };

/** Dừng: lượt chưa kết thúc. Chạy lại cả lượt: lượt đã kết thúc, chưa biết bị gắn gói (409 `pack_bound` sẽ đổi nút). Thành viên: không có nút. */
export function runControls(status: string, role: ControlRole, packBound: boolean): RunControls {
  const admin = role === "platform_admin" || role === "tenant_admin";
  return {
    canStop: admin && !isRunEnded(status),
    canRerun: admin && isRunEnded(status) && !packBound,
  };
}

/** "Mở lại quy trình": lượt gắn hợp đồng + (tenant_admin của chính công ty đó, hoặc platform_admin của MỌI công ty — CR-121 Q-3:
 *  API gói nhận `?tenant_id` + lý do tự nhập; server kiểm vai và ghi audit). */
export function canReopenUi(
  role: ControlRole,
  source: { kind: string } | null,
  runTenantId: string,
  myTenantId: string | undefined,
): boolean {
  if (source?.kind !== "contract") return false;
  return role === "platform_admin" || (role === "tenant_admin" && runTenantId === myTenantId);
}

/** Liên kết tới hợp đồng ở app phục vụ (`/contracts/c/:id`); chưa biết URL app ⇒ `null`. */
export function contractLink(appUrl: string | undefined, id: string): string | null {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/contracts/c/${encodeURIComponent(id)}` : null;
}

const RERUNNABLE_STEP = new Set(["done", "failed", "needs_decision", "waiting_timer"]);

/** Chạy lại bước: chỉ platform_admin; bước lỗi/xong; lượt chưa bị dừng/hết hạn. */
export function canRerunStepUi(role: ControlRole, runStatus: string, rawStatus: string): boolean {
  if (role !== "platform_admin") return false;
  if (runStatus === "cancelled" || runStatus === "expired") return false;
  return RERUNNABLE_STEP.has(rawStatus);
}

/** Tab "Gỡ lỗi" chỉ khi server trả mức debug (server quyết theo vai). */
export const hasDebugTab = (level: "basic" | "debug"): boolean => level === "debug";

export const CONTROL_REASONS: readonly RunControlReason[] = [
  "sent_by_mistake",
  "needs_edit",
  "bad_data",
  "other",
];

export const isPackBoundError = (err: unknown): boolean =>
  err instanceof ApiError &&
  err.status === 409 &&
  typeof err.details === "object" &&
  err.details !== null &&
  (err.details as { pack_bound?: unknown }).pack_bound === true;

/** Khoá i18n câu lỗi dễ hiểu cho thao tác điều khiển. */
export function controlErrorKey(err: unknown): string {
  if (isPackBoundError(err)) return "process.admin.runDetail.err.packBound";
  if (err instanceof ApiError) {
    if (err.status === 409) return "process.admin.runDetail.err.state";
    if (err.status === 403) return "process.admin.runDetail.err.forbidden";
    if (err.status === 404) return "process.admin.runDetail.err.notFound";
  }
  return "process.admin.runDetail.err.generic";
}

/** Thời lượng (ms) → "1 giờ 02 phút" gọn: `1h 02m` / `3m 05s` / `12s`. */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** CR-125 G2 · hub trả mã trạng thái + câu; chờ duyệt ⇒ web dịch bằng MỘT khoá (`process.run.line.reviewOther`), giữ phần "— bước …" của hub. */
export const WAITING_REVIEW_KEY = "process.run.line.reviewOther";
export function runStatusLine(status: string, hubText: string, t: (key: string) => string): string {
  if (status !== "waiting_review") return hubText;
  const i = hubText.indexOf(" — ");
  return i < 0 ? t(WAITING_REVIEW_KEY) : `${t(WAITING_REVIEW_KEY)}${hubText.slice(i)}`;
}
