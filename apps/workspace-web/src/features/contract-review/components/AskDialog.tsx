// CR-127 · U5: hộp lý do / bằng chứng của Rút về · Tạm khoá · Mở khoá · "Không đổi gì" (tách khỏi HeadActions).
import { Button } from "@ai/web-kit/ui/kit/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { EMPTY_EVIDENCE, type EvidenceDraft, EvidenceInput, evidenceIssue } from "~/platform/flow";

export type Ask = "withdraw" | "hold" | "release" | "unchanged" | null;
export const RULE = { mode: "opinion_plus", signature: false, files: true } as const;

export function AskDialog(p: {
  kind: Exclude<Ask, null>;
  busy: boolean;
  err: string | null;
  onCancel: () => void;
  onOk: (reason: string, ev: EvidenceDraft) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [ev, setEv] = useState<EvidenceDraft>(EMPTY_EVIDENCE);
  const [tried, setTried] = useState(false);
  const needsProof = p.kind === "hold" || p.kind === "release";
  const issue = needsProof ? evidenceIssue({ ...ev, note: ev.note || reason }, RULE) : null;
  const L = (k: string) => t(`contracts.u5.ask.${p.kind}.${k}`);
  return (
    <Dialog open onOpenChange={(o) => !o && p.onCancel()}>
      <DialogContent
        aria-label={L("title")}
        data-testid={`ask-${p.kind}`}
        showCloseButton={false}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{L("title")}</DialogTitle>
          <DialogDescription className="text-caption text-dim">{L("hint")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {needsProof ? (
            <EvidenceInput
              rule={RULE}
              value={ev}
              onChange={setEv}
              issue={tried ? issue : null}
              disabled={p.busy}
            />
          ) : (
            <textarea
              aria-label={L("title")}
              rows={3}
              className="w-full rounded-md border border-rule bg-panel px-3 py-2 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          {p.err && (
            <p role="alert" className="text-sm text-late" data-testid="ask-error">
              {p.err}
            </p>
          )}
        </DialogBody>
        <DialogFooter className="flex-row justify-end">
          <Button variant="quiet" size="sm" onClick={p.onCancel}>
            {t("contracts.common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            data-testid="ask-ok"
            disabled={p.busy}
            onClick={() => {
              setTried(true);
              if (needsProof ? issue === null : reason.trim() !== "")
                p.onOk(needsProof ? ev.note : reason, ev);
            }}
          >
            {L("ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
