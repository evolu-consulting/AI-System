// platform/gd0_dlc_fix · thẻ "chờ duyệt" của run DLC trên khung nhập — hiện cả khi UI quy trình bị ẩn (PUBLIC_FROZEN_MODULES off,
// cổng engine off) vì chỉ phục vụ gói `dlc`. Tự nạp chuỗi `process.*`; lỗi/403 (không phải admin ở HUB_PROCESS_ROUTES=admin) ⇒ ẩn.
import { PROCESS_RUN_ACTIVE } from "@ai/contracts/chat";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ensureProcessLocale } from "~/app/i18n";
import { processKeys } from "../../shared/keys";
import { reasonKey, reasonParams } from "../../shared/lib/decision-reason";
import { listConversationRuns } from "../api";
import { isDlcProcess } from "../lib/dlc-review";
import { DlcAppLink } from "./DlcAppLink";
import { DlcDecisionActions } from "./DlcDecisionActions";
import { DlcProgress } from "./DlcProgress";
import { DlcReviewButton, showDlcDecision, showDlcReview } from "./DlcReviewDialog";

const POLL_MS = 15_000;

export function DlcConversationReview({ conversationId }: { conversationId: string }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const runs = useQuery({
    queryKey: processKeys.runs(`dlc:${conversationId}`),
    queryFn: ({ signal }) => listConversationRuns(conversationId, signal),
    retry: false,
    refetchInterval: (q) => (q.state.status === "error" ? false : POLL_MS),
  });
  // dlc-progress · mọi lượt DLC còn chạy (không chỉ chờ duyệt/quyết) để người thấy lượt đang ở bước nào.
  const dlcRuns = (runs.data?.items ?? []).filter((r) => isDlcProcess(r.process.key));
  const waiting = dlcRuns.filter((r) =>
    (PROCESS_RUN_ACTIVE as readonly string[]).includes(r.status),
  );
  // lượt DLC xong gần nhất (đầu danh sách = mới nhất) ⇒ thẻ "đã xong" + link mở app vừa deploy (yêu cầu: xong phải thấy URL)
  const finished = waiting.length === 0 ? dlcRuns.find((r) => r.status === "done") : undefined;
  const locale = useQuery({
    queryKey: processKeys.locale(lng),
    queryFn: async () => {
      await ensureProcessLocale(lng);
      return true;
    },
    enabled: waiting.length > 0 || !!finished,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if ((waiting.length === 0 && !finished) || locale.data !== true) return null;
  if (finished)
    return (
      <section aria-label={t("process.run.dlcReview.section")} className="mb-3 flex flex-col gap-2">
        <article
          data-run-id={finished.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
        >
          <span className="min-w-0 truncate text-sm text-foreground">
            {t("process.run.dlcProgress.finished", { name: finished.process.name })}
          </span>
          <DlcAppLink runId={finished.id} />
        </article>
      </section>
    );
  return (
    <section aria-label={t("process.run.dlcReview.section")} className="mb-3 flex flex-col gap-2">
      {waiting.map((run) => (
        <article
          key={run.id}
          data-run-id={run.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
        >
          {showDlcDecision(run) ? (
            <>
              <span className="min-w-0 text-sm text-foreground">
                {t("process.run.dlcReview.stopped", {
                  name: run.process.name,
                  reason: run.decision_reason
                    ? t(reasonKey(run.decision_reason), reasonParams(run.decision_reason))
                    : "",
                })}
              </span>
              <DlcDecisionActions runId={run.id} />
            </>
          ) : showDlcReview(run) ? (
            <>
              <span className="min-w-0 truncate text-sm text-foreground">
                {t("process.run.dlcReview.waiting", { name: run.process.name })}
              </span>
              <DlcReviewButton run={run} />
            </>
          ) : (
            <span className="min-w-0 truncate text-sm text-foreground">
              {t("process.run.dlcProgress.running", { name: run.process.name })}
            </span>
          )}
          <DlcProgress runId={run.id} conversationId={conversationId} />
        </article>
      ))}
    </section>
  );
}
