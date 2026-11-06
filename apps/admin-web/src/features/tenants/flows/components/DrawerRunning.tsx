// CR-121 c11 · R4 · khối "Đang chạy" của MỘT việc: các lượt chưa kết thúc (API lượt chạy lọc theo việc, R9).
// Tóm tắt lượt chạy CHƯA có nhãn bản ghi (HĐ) ⇒ hiện tên việc + giờ bắt đầu + bước hiện tại, không id thô (khi API thêm nhãn: thay `title`).
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useSlotRuns } from "../api";

const WAITING = new Set(["waiting_review", "waiting_answer", "needs_decision", "waiting_timer"]);

export function DrawerRunning({
  tenantId,
  slot,
  jobName,
  isPlatform,
}: {
  tenantId: string;
  slot: string;
  jobName: string;
  isPlatform: boolean;
}) {
  const { t, i18n } = useTranslation();
  const q = useSlotRuns(tenantId, slot, isPlatform, true);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === "vi" ? "vi-VN" : "en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <section
      className="space-y-2"
      aria-label={t("tenants.flows.running")}
      data-testid={`flows-running-${slot}`}
    >
      <h3 className="text-label font-semibold">{t("tenants.flows.running")}</h3>
      {q.isError ? (
        <p role="alert" className="text-caption text-destructive">
          {t("tenants.flows.loadFail")}
        </p>
      ) : q.data && q.data.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("tenants.flows.runningNone")}</p>
      ) : (
        <ul className="space-y-1">
          {(q.data ?? []).map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-2 text-body"
              data-testid={`flows-run-${r.id}`}
            >
              <span className="min-w-0 truncate">
                {t("tenants.flows.runTitle", { job: jobName, at: when(r.started_at) })}
              </span>
              <span className="text-caption text-muted-foreground">
                {t("tenants.flows.runStep", { n: r.current_step + 1, total: r.step_count })}
              </span>
              <StatusBadge tone={WAITING.has(r.status) ? "warn" : "info"}>
                {t(WAITING.has(r.status) ? "tenants.flows.runWaiting" : "tenants.flows.runRunning")}
              </StatusBadge>
              <span className="text-caption text-muted-foreground">
                {r.started_by.display_name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
