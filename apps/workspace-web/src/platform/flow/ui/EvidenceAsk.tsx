// CR-127 · U4 · khối «ý kiến + chữ ký + tệp» kèm nút gửi của MỘT hành động quyết (Duyệt/Trả lại/Từ chối): dùng chung thẻ HĐ và trang yêu cầu.
import type { EvidenceInput as EvidenceBody } from "@ai/contracts/chat";
import type { FlowActionDef } from "@ai/contracts/flow";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import {
  EMPTY_EVIDENCE,
  type EvidenceDraft,
  type EvidenceRule,
  evidenceBody,
  evidenceIssue,
} from "../lib/evidence";
import { prefersReducedMotion, REVEAL_FLASH_MS, revealEvidence } from "../lib/reveal";
import { ACTION_VARIANT } from "./action-variant";
import { EvidenceInput } from "./EvidenceInput";

export function EvidenceAsk(p: {
  action: FlowActionDef;
  rule: EvidenceRule;
  busy: boolean;
  onSend: (body: EvidenceBody) => void;
  onCancel: () => void;
  /** CR-170: mở từ nút đầu trang ⇒ cuộn tới ô, con trỏ vào ô ý kiến, nổi ô vài giây, kèm câu hướng dẫn. */
  reveal?: boolean;
  /** CR-181 s13: khung «Ký trên tài liệu» (thay ô vẽ); `ready=false` ⇒ nút quyết khoá kèm lý do. */
  docSign?: { slot: ReactNode; ready: boolean } | undefined;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<EvidenceDraft>(EMPTY_EVIDENCE);
  const [tried, setTried] = useState(false);
  const issue = evidenceIssue(draft, p.rule);
  const box = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(Boolean(p.reveal));
  useEffect(() => {
    if (!p.reveal) return;
    revealEvidence(
      box.current,
      box.current?.querySelector("textarea") ?? null,
      prefersReducedMotion(),
    );
    const id = setTimeout(() => setFlash(false), REVEAL_FLASH_MS);
    return () => clearTimeout(id);
  }, [p.reveal]);
  return (
    <div
      ref={box}
      className={`flex flex-col gap-2 rounded-lg transition-shadow ${flash ? "ring-2 ring-primary ring-offset-2" : ""}`}
      data-testid="request-evidence"
      data-flash={flash ? "on" : "off"}
    >
      {p.reveal && (
        <p className="text-sm font-medium" data-testid="evidence-ask-hint">
          {t(
            p.action.key === "approve"
              ? "contracts.work.u4.evidence.askHint"
              : "contracts.work.u4.evidence.askHintReason",
          )}
        </p>
      )}
      <EvidenceInput
        rule={p.rule}
        value={draft}
        onChange={setDraft}
        issue={tried ? issue : null}
        disabled={p.busy}
        signSlot={p.docSign?.slot}
      />
      <div className="flex gap-2">
        <Btn
          variant={ACTION_VARIANT[p.action.style]}
          loading={p.busy}
          disabled={p.docSign ? !p.docSign.ready : false}
          {...(p.docSign && !p.docSign.ready ? { reason: t("contracts.docsignc.gate") } : {})}
          data-testid={`request-${p.action.key}-confirm`}
          onClick={() => (issue ? setTried(true) : p.onSend(evidenceBody(draft, p.rule)))}
        >
          {p.action.label}
        </Btn>
        <Btn onClick={p.onCancel}>{t("contracts.requests.cancel")}</Btn>
      </div>
    </div>
  );
}
