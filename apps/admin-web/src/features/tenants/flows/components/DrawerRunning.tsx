// CR-121 c11 · R4 · khối "Đang chạy" của MỘT việc: các lượt chưa kết thúc (API lượt chạy lọc theo việc, R9).
// Tóm tắt lượt chạy CHƯA có nhãn bản ghi (HĐ) ⇒ hiện tên việc + giờ bắt đầu + bước hiện tại, không id thô (khi API thêm nhãn: thay `title`).

import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureProcessLocale } from "@/app/i18n";
import { RunStatusBadge } from "@/features/processes/components/run/RunStatusBadge";
import { useSlotRuns } from "../api";
import { runTitle } from "../lib/run-title";

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
  // Nhãn trạng thái dùng chung `RunStatusBadge` (chuỗi `process.common.status.*` nạp lười, trang công ty chưa nạp sẵn).
  const [labels, setLabels] = useState(false);
  useEffect(() => {
    let live = true;
    void ensureProcessLocale(i18n.language).then(() => live && setLabels(true));
    return () => {
      live = false;
    };
  }, [i18n.language]);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === "vi" ? "vi-VN" : "en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    });
  const title = (r: { record_label?: string | null; started_at: string }) =>
    runTitle(t, r, jobName, when(r.started_at));
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
              {/* Mở trang chi tiết lượt chạy (Tpl-Run); platform kèm công ty đang xem, tenant_admin: Hub suy từ phiên */}
              <Link
                to="/processes/$processId/runs/$runId"
                params={{ processId: r.process.key, runId: r.id }}
                search={isPlatform ? { company: tenantId } : {}}
                className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                data-testid={`flows-run-open-${r.id}`}
              >
                {title(r).primary}
                {title(r).secondary && (
                  <span className="block text-caption text-muted-foreground">
                    {title(r).secondary}
                  </span>
                )}
              </Link>
              <span className="text-caption text-muted-foreground">
                {t("tenants.flows.runStep", { n: r.current_step + 1, total: r.step_count })}
              </span>
              {labels ? <RunStatusBadge status={r.status} /> : null}
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
