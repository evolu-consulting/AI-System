// HUB-FR-143…145 · CA-R03/R04 · CONVENTIONS §5 · plan-domain §3, §6: biên contract/DB ↔ domain `processes`. Chuỗi đọc
// từ DB thu hẹp về union domain (lệch ⇒ ném — CHECK DB và contract phải đổi cùng nhau); lỗi domain ⇒ mã contract + HTTP.
import { type ChatProcessErrorCode, PROCESS_RUN_STATUSES, TIMER_KINDS } from "@ai/contracts/chat";
import type { HubAdminProcessErrorCode } from "@ai/contracts/hub-admin";
import type { AppError } from "../../../lib/errors";
import { processError } from "../core/errors";
import { defError } from "../defs/defs.map";
import type { DomainError, ProcessDomainError } from "../domain/errors";
import type { ProcessRunStatus, TimerKind } from "../domain/types";

function narrow<T extends string>(all: readonly T[], what: string): (v: string) => T {
  return (v) => {
    if ((all as readonly string[]).includes(v)) return v as T;
    throw new Error(`${what} không hợp lệ: ${v}`);
  };
}
export const runStatusOf: (v: string) => ProcessRunStatus = narrow(
  PROCESS_RUN_STATUSES,
  "run status",
);
export const timerKindOf: (v: string) => TimerKind = narrow(TIMER_KINDS, "timer kind");

type ErrorTarget =
  | { block: "process"; code: ChatProcessErrorCode }
  | { block: "def"; code: HubAdminProcessErrorCode };

/** Thiếu mã domain ⇒ typecheck đỏ (`Record`). HTTP status lấy từ bảng lỗi contract qua `processError`/`defError`. */
export const DOMAIN_ERROR_MAP: Record<ProcessDomainError, ErrorTarget> = {
  RUN_STATE: { block: "process", code: "PROCESS_RUN_STATE" },
  NO_OUTPUT: { block: "process", code: "NO_OUTPUT" },
  // Không lộ trạng thái hẹn giờ ra client.
  TIMER_STATE: { block: "process", code: "PROCESS_RUN_STATE" },
  REF_INVALID: { block: "def", code: "PROCESS_REF_INVALID" },
  DEF_INVALID: { block: "def", code: "PROCESS_DEF_INVALID" },
  // T6c · tenant sai dạng: không lộ gì hơn "không thấy".
  TENANT_INVALID: { block: "process", code: "PROCESS_NOT_FOUND" },
};

export function domainErrorToApp(e: DomainError): AppError {
  const t = DOMAIN_ERROR_MAP[e.code];
  return t.block === "process" ? processError(t.code, e.details) : defError(t.code, e.details);
}
