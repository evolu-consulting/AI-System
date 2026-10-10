// CHAT-AC-53 · plan-frontend §3: thẻ "Cần người quyết" — 3 nút theo `task.options`, ghi chú ≤ 500. Mount một lần (DecisionMessage).
import { type DecisionOption, FORWARD_NOTE_MAX } from "@ai/contracts/chat";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { ApiError } from "~/lib/http";
import { reasonKey, reasonParams } from "../../shared/lib/decision-reason";
import type { TaskCardProps } from "../../shared/types";
import { useDecide } from "../hooks/use-decide";

// D6c (UAT 2026-10-11): trong thread, `DecisionMessage` đã in tiêu đề "Quy trình dừng ở giai đoạn…" + lý do ở trên,
// nên thẻ nhúng ẩn hai dòng đó để không lặp; trang lượt chạy (TaskPanel) không nhúng ⇒ vẫn in đủ.
export function DecisionCard({ runId, task, embedded }: TaskCardProps & { embedded?: boolean }) {
  const { t } = useTranslation();
  const decide = useDecide(runId);
  const [note, setNote] = useState("");
  const [noOutput, setNoOutput] = useState(false);
  const options = task.options ?? [];
  const over = note.length > FORWARD_NOTE_MAX;

  const run = useCallback(
    async (option: DecisionOption) => {
      setNoOutput(false);
      try {
        await decide.mutateAsync({ option, note: note.trim() || undefined });
        toast.success(t("process.run.decision.done"));
      } catch (err) {
        if (err instanceof ApiError && err.code === "NO_OUTPUT") {
          setNoOutput(true);
          return;
        }
        const key = err instanceof ApiError ? `process.common.apiError.${err.code}` : "";
        const msg = t(key);
        toast.error(msg && msg !== key ? msg : t("process.common.error.network"));
      }
    },
    [decide, note, t],
  );

  // E-P7: `my_tasks` của assignee giữ cả task đã đóng (sau add_attempt) ⇒ ẩn thẻ khi quyết định xong (như Review/Ask).
  if (task.status === "closed") return null;
  const useCurrentDisabled = task.has_output === false || decide.isPending;
  return (
    <section
      aria-label={t("process.run.decision.region")}
      className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-card p-3"
    >
      {!embedded && (
        <p className="text-sm font-medium">
          {t("process.run.decision.title", { stage: task.stage_name })}
        </p>
      )}
      {!embedded && task.reason && (
        <p className="text-caption text-secondary-foreground">
          {t(reasonKey(task.reason), reasonParams(task.reason))}
        </p>
      )}
      <Textarea
        aria-label={t("process.run.decision.note")}
        value={note}
        maxLength={FORWARD_NOTE_MAX + 1}
        onChange={(e) => setNote(e.target.value)}
      />
      {over && (
        <p className="text-caption text-destructive">
          {t("process.common.validate.tooLong", { max: FORWARD_NOTE_MAX })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.includes("add_attempt") && (
          <Button
            type="button"
            size="sm"
            disabled={over || decide.isPending}
            onClick={() => void run("add_attempt")}
          >
            {t("process.common.option.add_attempt")}
          </Button>
        )}
        {options.includes("use_current") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={useCurrentDisabled || over}
            onClick={() => void run("use_current")}
          >
            {t("process.common.option.use_current")}
          </Button>
        )}
        {options.includes("cancel") && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="destructive" disabled={decide.isPending}>
                {t("process.common.option.cancel")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("process.run.cancel.title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("process.run.cancel.body")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("process.run.cancel.keep")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void run("cancel")}>
                  {t("process.run.cancel.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {noOutput && (
        <p className="text-caption text-destructive">{t("process.run.decision.noOutput")}</p>
      )}
    </section>
  );
}
