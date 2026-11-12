// CR-127 · U4 · khối «ý kiến + chữ ký + tệp» kèm nút gửi của MỘT hành động quyết (Duyệt/Trả lại/Từ chối): dùng chung thẻ HĐ và trang yêu cầu.
import type { EvidenceInput as EvidenceBody } from "@ai/contracts/chat";
import type { FlowActionDef } from "@ai/contracts/flow";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import {
  EMPTY_EVIDENCE,
  type EvidenceDraft,
  type EvidenceRule,
  evidenceBody,
  evidenceIssue,
} from "../lib/evidence";
import { ACTION_VARIANT } from "./action-variant";
import { EvidenceInput } from "./EvidenceInput";

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
        <Btn
          variant={ACTION_VARIANT[p.action.style]}
          loading={p.busy}
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
