// HUB-FR-66 · AC-H4b2-02 · D3 · mockup H4b2-Check: hộp "Kết quả kiểm tra · {key}" dùng chung cho api ("Kiểm tra key") và
// subscription ("Kiểm tra lại"). Một `status` duy nhất (aria-live); lỗi nguyên văn của hãng (đã che key) trong "Chi tiết".
import type { ProviderCheckResult } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import type { CheckState, CheckTarget } from "../hooks/use-check-provider";
import { detailText, resultText, runningKey, type Tone } from "../lib/check-text";

const TONE: Record<Tone, string> = {
  ok: "bg-success-bg text-success",
  error: "bg-danger-bg text-danger",
  info: "bg-accent text-accent-foreground",
};
const BOX = "rounded-md px-3 py-2 font-medium";

function Result({ r, sub }: { r: ProviderCheckResult; sub: boolean }) {
  const { t, i18n } = useTranslation();
  const head = resultText(r, sub);
  const detail = detailText(r);
  const at = new Date(r.checked_at);
  const shown = r.status === "ok" || r.status === "error";
  const time = at.toLocaleString(i18n.language, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="space-y-3">
      <p role="status" aria-live="polite" className={`${BOX} ${TONE[head.tone]}`}>
        {t(head.key, head.params)}
      </p>
      {shown && !Number.isNaN(at.getTime()) ? (
        <p className="text-label text-muted-foreground">{t("models.check.checkedAt", { time })}</p>
      ) : null}
      {shown && detail ? (
        <details open aria-label={t("models.check.details")} className="text-label">
          <summary className="cursor-pointer font-semibold text-muted-foreground">
            {t("models.check.details")}
          </summary>
          <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-micro">
            {detail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function Body({ state }: { state: CheckState }) {
  const { t } = useTranslation();
  if (state.phase === "running")
    return (
      <p role="status" aria-live="polite" aria-busy="true" className={`${BOX} bg-muted`}>
        {t(runningKey(state.sub))}
      </p>
    );
  if (state.phase === "done") return <Result r={state.result} sub={state.sub} />;
  return (
    <p role="alert" className={`${BOX} ${TONE.error}`}>
      {t(state.msg.key, state.msg.params)}
    </p>
  );
}

export function CheckDialog({
  state,
  onClose,
  onRecheck,
}: {
  state: CheckState | null;
  onClose: () => void;
  onRecheck: (p: CheckTarget) => void;
}) {
  const { t } = useTranslation();
  const running = state?.phase === "running";
  const canRecheck =
    state !== null && !(state.phase === "done" && state.result.status === "unsupported");
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("models.check.title", { key: state?.target.key ?? "" })}</DialogTitle>
          <DialogDescription className="sr-only">{t("models.check.desc")}</DialogDescription>
        </DialogHeader>
        {state ? <Body state={state} /> : null}
        <DialogFooter>
          {canRecheck ? (
            <Button
              type="button"
              variant="outline"
              disabled={running}
              onClick={() => state && onRecheck(state.target)}
            >
              {t("models.check.again")}
            </Button>
          ) : null}
          <Button type="button" disabled={running} onClick={onClose}>
            {t("models.check.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
