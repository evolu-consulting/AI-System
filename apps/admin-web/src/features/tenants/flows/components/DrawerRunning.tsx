// CR-121 c11 · R4 · khối "Đang chạy" của MỘT việc: các lượt chưa kết thúc (API lượt chạy lọc theo việc, R9).
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useSlotRuns } from "../api";

const WAITING = new Set(["waiting_review", "waiting_answer", "needs_decision", "waiting_timer"]);

export function DrawerRunning({
  tenantId,
  slot,
  isPlatform,
}: {
  tenantId: string;
  slot: string;
  isPlatform: boolean;
}) {
  const { t } = useTranslation();
  const q = useSlotRuns(tenantId, slot, isPlatform, true);
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
              <span className="min-w-0 truncate">{r.process.name}</span>
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
