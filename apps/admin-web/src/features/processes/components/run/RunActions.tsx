// ADM-FR-67 · CR-056 · P-a F5: "Cần người quyết" (3 lựa chọn + ghi chú, `can_decide`) và "Huỷ lượt chạy" (`can_cancel`).
import type { ProcessRunFullView } from "@ai/contracts/chat";
import { DECISION_REASONS } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAttachmentLoader } from "../../hooks/use-attachment-loader";
import { useRunAction } from "../../hooks/use-run-data";
import { applyOf } from "../../lib/apply-view";
import { currentAutofix } from "../../lib/autofix-view";
import { processErrorSpec } from "../../lib/errors";
import { ApplyIssue } from "./apply/ApplyIssue";
import { AutofixFailures } from "./autofix/AutofixFailures";

type Props = { run: ProcessRunFullView; tenantId: string | undefined };
const NOTE_MAX = 500;

function reasonText(t: ReturnType<typeof useTranslation>["t"], run: ProcessRunFullView): string {
  const d = run.decision;
  if (!d) return "";
  const known = (DECISION_REASONS as readonly string[]).includes(d.reason);
  const stage = run.stages[d.stage_idx];
  return known
    ? t(`process.common.${d.reason}`, { max: stage?.attempt_limit ?? stage?.ask_limit ?? 0 })
    : d.reason;
}

function ReasonTitle({ run, round }: { run: ProcessRunFullView; round?: number }) {
  const { t } = useTranslation();
  const r = run.decision?.reason;
  if (isHeadingReason(r)) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-semibold">{reasonText(t, run)}</h3>
        {r === "autofix_check_failed" && round !== undefined && (
          <Badge variant="info">{t("process.common.autofix.round", { n: round })}</Badge>
        )}
      </div>
    );
  }
  return <p className="text-body text-muted-foreground">{reasonText(t, run)}</p>;
}

const isHeadingReason = (r: string | undefined): boolean =>
  r === "autofix_check_failed" ||
  r === "sandbox_unavailable" ||
  r === "apply_conflict" ||
  r === "apply_failed";

const autofixOrder = <T extends string>(opts: T[], reason: string | undefined): T[] =>
  isHeadingReason(reason)
    ? [...opts].sort((a, b) => Number(b === "cancel") - Number(a === "cancel"))
    : opts;

const HINTED = new Set<string>([
  "source_unresolvable",
  "autofix_check_failed",
  "sandbox_unavailable",
  "apply_conflict",
]);

function ReasonBody({
  run,
  failed,
  load,
}: {
  run: ProcessRunFullView;
  failed: ReturnType<typeof currentAutofix>;
  load: ReturnType<typeof useAttachmentLoader>;
}) {
  const { t } = useTranslation();
  const d = run.decision;
  if (!d) return null;
  const hint = HINTED.has(d.reason) ? (
    <p className="text-caption text-muted-foreground">{t(`process.common.${d.reason}_hint`)}</p>
  ) : null;
  return (
    <>
      {hint}
      {(d.reason === "apply_conflict" || d.reason === "apply_failed") && (
        <ApplyIssue reason={d.reason} apply={applyOf(run.stages, d.stage_idx)} load={load} />
      )}
      {d.reason === "autofix_check_failed" && <AutofixFailures view={failed} load={load} />}
    </>
  );
}

export function RunActions({ run, tenantId }: Props) {
  const { t } = useTranslation();
  const act = useRunAction(run.id, tenantId);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const d = run.decision;
  const deciding = d?.can_decide === true;
  const fail = (err: unknown) => {
    const s = processErrorSpec(err);
    notifyError(t(s.key, s.params));
  };
  const decide = (option: "add_attempt" | "use_current" | "cancel") =>
    act.mutate(
      { option, note },
      { onSuccess: () => notifySuccess(t("process.admin.run.decision.done")), onError: fail },
    );
  const load = useAttachmentLoader(tenantId);
  // Chỉ lỗi của vòng hiện tại; vòng này không có báo cáo ⇒ AutofixFailures hiện "không có báo cáo chi tiết".
  const failed = d ? currentAutofix(run.stages, d.stage_idx) : undefined;
  // Mockup Pc-Decision: tự sửa mã ⇒ "Huỷ quy trình" (viền) trước, "Thêm lượt" (nền chính) sau.
  const options = autofixOrder(d?.options ?? [], d?.reason);
  const hasOutput = (run.stages[d?.stage_idx ?? 0]?.outputs.length ?? 0) > 0;
  return (
    <div className="space-y-3">
      {d ? (
        <section
          aria-label={t("process.admin.run.decision.region")}
          className="space-y-3 rounded-lg border border-border bg-card p-4"
        >
          <h2 className="text-body font-semibold">
            {t("process.admin.run.decision.title", {
              stage: run.stages[d.stage_idx]?.name ?? "",
            })}
          </h2>
          <ReasonTitle run={run} round={failed?.round} />
          <ReasonBody run={run} failed={failed} load={load} />
          {deciding ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="decision-note">{t("process.admin.run.decision.note")}</Label>
                <Textarea
                  id="decision-note"
                  rows={2}
                  maxLength={NOTE_MAX}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {options.map((o) => (
                  <Button
                    key={o}
                    variant={o === "cancel" ? "outline" : "default"}
                    disabled={act.isPending || (o === "use_current" && !hasOutput)}
                    onClick={() => decide(o)}
                  >
                    {t(`process.common.option.${o}`)}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-label text-muted-foreground">
              {t("process.admin.run.decision.waiting")}
            </p>
          )}
        </section>
      ) : null}
      {run.can_cancel && !deciding ? (
        <>
          <Button variant="outline" onClick={() => setConfirm(true)}>
            {t("process.common.option.cancel")}
          </Button>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={t("process.admin.run.cancel.title")}
            description={t("process.admin.run.cancel.body")}
            confirmLabel={t("process.admin.run.cancel.confirm")}
            destructive
            onConfirm={() =>
              act.mutateAsync("cancel").then(
                () => notifySuccess(t("process.admin.run.cancel.done")),
                (err) => {
                  fail(err);
                  throw err;
                },
              )
            }
          />
        </>
      ) : null}
    </div>
  );
}
