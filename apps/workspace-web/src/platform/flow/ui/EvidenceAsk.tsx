// CR-127 · U4 · khối «ý kiến + chữ ký + tệp» kèm nút gửi của MỘT hành động quyết (Duyệt/Trả lại/Từ chối): dùng chung thẻ HĐ và trang yêu cầu.
import type { EvidenceInput as EvidenceBody } from "@ai/contracts/chat";
import type { FlowActionDef } from "@ai/contracts/flow";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EMPTY_EVIDENCE,
  type EvidenceDraft,
  type EvidenceRule,
  evidenceBody,
  evidenceIssue,
} from "../lib/evidence";
import { EvidenceInput } from "./EvidenceInput";

const BTN: Record<FlowActionDef["style"], string> = {
  primary: "btn btn-primary",
  default: "btn",
  danger: "btn border border-late bg-panel text-late hover:bg-late-bg",
};

export function EvidenceAsk(p: {
  action: FlowActionDef;
  rule: EvidenceRule;
  busy: boolean;
  onSend: (body: EvidenceBody) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<EvidenceDraft>(EMPTY_EVIDENCE);
  const [tried, setTried] = useState(false);
  const issue = evidenceIssue(draft, p.rule);
  return (
    <div className="flex flex-col gap-2" data-testid="request-evidence">
      <EvidenceInput
        rule={p.rule}
        value={draft}
        onChange={setDraft}
        issue={tried ? issue : null}
        disabled={p.busy}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className={BTN[p.action.style]}
          disabled={p.busy}
          data-testid={`request-${p.action.key}-confirm`}
          onClick={() => (issue ? setTried(true) : p.onSend(evidenceBody(draft, p.rule)))}
        >
          {p.action.label}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={p.onCancel}>
          {t("contracts.requests.cancel")}
        </button>
      </div>
    </div>
  );
}
