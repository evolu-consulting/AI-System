// CR-121 · R-3: đầu trang "Chi tiết lượt chạy" — mã lượt (sao chép), quy trình + phiên bản, công ty, kích hoạt bởi, mốc thời gian,
// trạng thái + lý do, nút icon Dừng / Chạy lại cả lượt.
import type { RunDetail } from "@ai/contracts/chat";
import { Copy, RotateCcw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { notifySuccess } from "@/components/shared/toast";
import { copyText } from "@/lib/clipboard";
import { formatClock } from "@/lib/format";
import { formatDuration, type RunControls } from "../../lib/run-detail-view";
import { RunStatusBadge } from "../run/RunStatusBadge";

type Props = {
  run: RunDetail;
  controls: RunControls;
  packBound: boolean;
  /** Đang chạy: thời lượng tính theo giờ hiện tại. */
  nowMs: number;
  onStop: () => void;
  onRerun: () => void;
};

export function RunHeader({ run, controls, packBound, nowMs, onStop, onRerun }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "vi" ? "vi" : "en";
  const T = (k: string, o?: Record<string, unknown>) => t(`process.admin.runDetail.${k}`, o);
  const end = run.finished_at ? Date.parse(run.finished_at) : nowMs;
  const duration = formatDuration(Math.max(0, end - Date.parse(run.started_at)));
  const facts: [string, string][] = [
    [T("fact.process"), `${run.process.name} · v${run.process.version}`],
    [T("fact.tenant"), run.tenant.name || "—"],
    [T("fact.startedBy"), `${run.started_by?.display_name ?? "—"} · ${run.origin.label[lang]}`],
    [T("fact.started"), formatClock(run.started_at)],
    [T("fact.finished"), run.finished_at ? formatClock(run.finished_at) : "—"],
    [T("fact.duration"), duration],
  ];
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-label text-muted-foreground" data-testid="run-id">
          {run.id}
        </span>
        <IconButton
          label={T("copyId")}
          onClick={async () => {
            if (await copyText(run.id)) notifySuccess(T("copied"));
          }}
        >
          <Copy aria-hidden />
        </IconButton>
        <div className="ml-auto flex items-center gap-1">
          {controls.canStop && (
            <IconButton label={T("ctl.stop.button")} onClick={onStop}>
              <Square aria-hidden />
            </IconButton>
          )}
          {controls.canRerun && (
            <IconButton label={T("ctl.rerun.button")} onClick={onRerun}>
              <RotateCcw aria-hidden />
            </IconButton>
          )}
        </div>
      </div>
      <dl className="m-0 mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-caption text-muted-foreground">{k}</dt>
            <dd className="m-0 break-words text-body">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        <span className="text-body" data-testid="run-status-text">
          {run.status_text[lang]}
        </span>
        {run.is_test && <span className="text-caption text-muted-foreground">{T("isTest")}</span>}
      </div>
      {packBound && (
        <p className="m-0 mt-2 text-body text-muted-foreground">{T("err.packBound")}</p>
      )}
    </section>
  );
}
