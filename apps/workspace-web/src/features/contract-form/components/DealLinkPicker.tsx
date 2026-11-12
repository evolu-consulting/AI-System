// CR-127 · U6 · M12: «Thuộc hợp đồng nào?» của giao dịch lập từ Sản phẩm & Giá. Có mốc mở của HĐ còn hiệu lực với đối tác ⇒ bắt buộc chọn một mốc
// hoặc «Không theo hợp đồng» (+ lý do); chọn mốc ⇒ ghi thẳng vào mốc, hiện ô Bằng chứng (cùng ô với bước Duyệt). Không có mốc mở ⇒ không hiện gì.
import type { OpenMilestone } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { type EvidenceDraft, evidenceIssue } from "~/platform/flow/lib/evidence";
import { EvidenceInput } from "~/platform/flow/ui/EvidenceInput";
import { LINK_EVIDENCE_RULE, type LinkChoice, type LinkIssue } from "../lib/deal-link";

type Props = {
  items: readonly OpenMilestone[];
  choice: LinkChoice;
  onChoice: (c: LinkChoice) => void;
  evidence: EvidenceDraft;
  onEvidence: (d: EvidenceDraft) => void;
  /** Thiếu gì (chỉ truyền sau khi người dùng bấm Lưu). */
  issue: LinkIssue | null;
  disabled?: boolean;
};

export function DealLinkPicker({
  items,
  choice,
  onChoice,
  evidence,
  onEvidence,
  issue,
  disabled,
}: Props) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <fieldset
      data-testid="deal-link"
      className="m-0 flex flex-col gap-2 rounded-lg border border-line px-4 py-3 text-[13.5px]"
    >
      <legend className="px-1 font-semibold">
        {t("contracts.u6.trade.which")} <span className="text-late">*</span>
      </legend>
      <p className="text-dim">{t("contracts.u6.trade.whichHint")}</p>
      {items.map((m) => {
        const picked = choice.kind === "milestone" && choice.obligationId === m.obligation_id;
        const late = m.due_date < today;
        return (
          <label
            key={m.obligation_id}
            className="flex items-start gap-2"
            data-testid="deal-link-milestone"
          >
            <input
              type="radio"
              name="deal-link"
              className="mt-1"
              checked={picked}
              disabled={disabled}
              onChange={() => onChoice({ kind: "milestone", obligationId: m.obligation_id })}
            />
            <span>
              <b>{m.contract_name}</b>
              <span className="block text-dim">
                {t("contracts.u6.trade.milestone", {
                  title:
                    m.title ?? t(`contracts.u6.trade.kind.${m.kind}`, { defaultValue: m.kind }),
                  due: viDate(m.due_date),
                })}
                {m.remaining ? ` · ${t("contracts.u6.trade.remaining", { n: m.remaining })}` : ""}
                {late && <span className="text-late"> · {t("contracts.u6.trade.late")}</span>}
              </span>
            </span>
          </label>
        );
      })}
      <label className="flex items-start gap-2" data-testid="deal-link-none">
        <input
          type="radio"
          name="deal-link"
          className="mt-1"
          checked={choice.kind === "none"}
          disabled={disabled}
          onChange={() =>
            onChoice({ kind: "none", reason: choice.kind === "none" ? choice.reason : "" })
          }
        />
        <span>
          <b>{t("contracts.u6.trade.none")}</b>
          <span className="block text-dim">{t("contracts.u6.trade.noneHint")}</span>
        </span>
      </label>
      {choice.kind === "none" && (
        <textarea
          className="field min-h-16"
          aria-label={t("contracts.u6.trade.reason")}
          placeholder={t("contracts.u6.trade.reasonHint")}
          value={choice.reason}
          disabled={disabled}
          onChange={(e) => onChoice({ kind: "none", reason: e.target.value })}
        />
      )}
      {choice.kind === "milestone" && (
        <div data-testid="deal-link-evidence" className="flex flex-col gap-1">
          <b>{t("contracts.u6.trade.evidence")}</b>
          <span className="text-dim">{t("contracts.u6.trade.evidenceHint")}</span>
          <EvidenceInput
            rule={LINK_EVIDENCE_RULE}
            value={evidence}
            onChange={onEvidence}
            issue={issue === "evidence" ? evidenceIssue(evidence, LINK_EVIDENCE_RULE) : null}
            disabled={disabled}
          />
        </div>
      )}
      {issue === "required" && (
        <p role="alert" className="text-late">
          {t("contracts.u6.trade.err.required")}
        </p>
      )}
      {issue === "reason" && (
        <p role="alert" className="text-late">
          {t("contracts.u6.trade.err.reason")}
        </p>
      )}
    </fieldset>
  );
}
