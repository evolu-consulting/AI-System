// ADM-FR-67 · CR-056 · P-a F5: nhãn trạng thái lượt chạy (chuỗi `process.common.status.*`).
import type { ProcessRunStatus } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";

const TONE: Record<ProcessRunStatus, StatusTone> = {
  running: "info",
  waiting_review: "warn",
  waiting_answer: "warn",
  needs_decision: "err",
  done: "ok",
  cancelled: "off",
  failed: "err",
  expired: "off",
  waiting_timer: "info", // P-d1 · plan-frontend FD9
};

export function RunStatusBadge({ status }: { status: ProcessRunStatus }) {
  const { t } = useTranslation();
  return <StatusBadge tone={TONE[status]}>{t(`process.common.status.${status}`)}</StatusBadge>;
}
