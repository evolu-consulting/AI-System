// platform/gd0_dlc_fix · run DLC `needs_decision` (vd bước bị gián đoạn khi máy chủ khởi động lại) hiện ngay trên khung nhập:
// lý do + các nút quyết của engine (`add_attempt` = chạy lại bước, `cancel`...). Trước đây chỉ `waiting_review` có thẻ, nên khi
// UI quy trình bị ẩn (PUBLIC_FROZEN_MODULES off) run kẹt `needs_decision` không ai thấy.
import type { DecisionOption } from "@ai/contracts/chat";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { useProcessRun } from "../../shared/hooks/use-process-run";
import { processKeys } from "../../shared/keys";
import { useDecide } from "../hooks/use-decide";
import { dlcDecisionTarget } from "../lib/dlc-review";
import { reviewErrorMessage } from "../lib/review-error";

export function DlcDecisionActions({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useProcessRun(runId);
  const mut = useDecide(runId);
  const [err, setErr] = useState<string | null>(null);
  const target = dlcDecisionTarget(q.data);
  if (!target) return null;
  const decide = async (option: DecisionOption) => {
    setErr(null);
    try {
      await mut.mutateAsync({ option, stage_idx: target.stageIdx });
      void qc.invalidateQueries({ queryKey: processKeys.all });
      toast.success(
        t("process.run.dlcReview.decided", { option: t(`process.common.option.${option}`) }),
      );
    } catch (e) {
      setErr(reviewErrorMessage(e, t) ?? t("process.run.dlcReview.none"));
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {target.options.map((o) => (
          <Button
            key={o}
            type="button"
            size="sm"
            variant={o === "cancel" ? "outline" : "default"}
            disabled={mut.isPending}
            onClick={() => void decide(o)}
          >
            {t(o === "add_attempt" ? "process.run.dlcReview.retry" : `process.common.option.${o}`)}
          </Button>
        ))}
      </div>
      {err && <p className="text-caption text-destructive">{err}</p>}
    </div>
  );
}
