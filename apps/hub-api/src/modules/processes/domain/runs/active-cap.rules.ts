// HUB-FR-105 · HUB-FR-143 · trần run đang chạy mỗi tenant — tập trạng thái tính vào trần (tách từ `runs.repo.countActive`, P-d1 T8s).
// Thuần, lớp 1: giá trị = `PROCESS_RUN_ACTIVE` của contract (`adapters/processes.mapper.test.ts` khẳng định).
import type { ProcessRunStatus } from "../types";

/** Trạng thái run được tính vào trần (khớp predicate `process_runs_active_idx`). */
export const ACTIVE_CAP_STATUSES: readonly ProcessRunStatus[] = [
  "running",
  "waiting_review",
  "waiting_answer",
  "needs_decision",
  "waiting_timer",
];

export const isActive = (s: ProcessRunStatus): boolean => ACTIVE_CAP_STATUSES.includes(s);

/** PD-R16 (HUB-FR-105): trạng thái tính vào trần 5 run/tenant — KHÔNG gồm `waiting_timer`. */
export const CAP_COUNTED: readonly ProcessRunStatus[] = [
  "running",
  "waiting_review",
  "waiting_answer",
  "needs_decision",
];

export const countsTowardCap = (s: ProcessRunStatus): boolean => CAP_COUNTED.includes(s);
