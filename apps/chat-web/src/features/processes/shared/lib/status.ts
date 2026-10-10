// CR-056 · P-a plan-frontend §6: trạng thái run → nhóm màu + cờ. Thuần, không I/O.
import { PROCESS_RUN_ACTIVE, type ProcessRunStatus, type StageRunStatus } from "@ai/contracts/chat";

export type StatusTone = "neutral" | "info" | "warn" | "success" | "danger";

const TONES: Record<ProcessRunStatus, StatusTone> = {
  running: "info",
  waiting_review: "warn",
  waiting_answer: "warn",
  needs_decision: "danger",
  done: "success",
  cancelled: "neutral",
  failed: "danger",
  expired: "neutral",
};

export const statusTone = (s: ProcessRunStatus): StatusTone => TONES[s];

/** Run còn sống (chưa done/cancelled/failed/expired). */
export const isActiveRun = (s: ProcessRunStatus): boolean =>
  (PROCESS_RUN_ACTIVE as readonly string[]).includes(s);

/** Khoá i18n nhãn trạng thái run. */
export const runStatusKey = (s: ProcessRunStatus) => `process.common.status.${s}`;

/** Khoá i18n nhãn trạng thái giai đoạn (chỉ `pending`/`queued` có chữ riêng, còn lại dùng nhãn run). */
export const stageStatusKey = (s: StageRunStatus): string =>
  s === "pending" || s === "queued" ? `process.common.stage.${s}` : `process.common.status.${s}`;
