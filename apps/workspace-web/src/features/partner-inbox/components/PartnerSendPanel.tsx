// CR-124 · q4 · FLOW4-FR-14/16/17 · khối «Gửi đối tác xác nhận» ở chi tiết HĐ (bên GỬI): mỗi vòng gửi một thẻ 3 dòng (trạng thái · lý do · bước kế).
// Vòng đang chờ có nút «Ghi nhận kết quả đối tác» (người phụ trách/ghi được HĐ; người khác không thấy nút) ⇒ Đồng ý / Trả lại / Từ chối + lý do +
// người bên đối tác trả lời + bằng chứng. Ẩn hẳn khi HĐ chưa từng gửi đối tác.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecordResult, useRounds } from "../hooks/use-partner-queries";
import { needsReason, type Round, recordIssue, roundCard } from "../lib/partner-view";
import { PartnerCard } from "./PartnerCard";

type Outcome = "confirmed" | "returned" | "declined";

function RecordForm({ round, onDone }: { round: Round; onDone: () => void }) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<Outcome>("confirmed");
  const [reason, setReason] = useState("");
  const [byName, setByName] = useState("");
  const [byTitle, setByTitle] = useState("");
  const [evidence, setEvidence] = useState("");
  const m = useRecordResult(round.mailbox_id, onDone);
  const issue = recordIssue({
    outcome,
    reason,
    byName,
    evidence: evidence.split("\n"),
    channel: round.channel,
  });
  return (
    <form
      data-testid="partner-record-form"
      className="mt-2 grid max-w-xl gap-2 rounded-xl border border-rule bg-sunk p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!issue)
          m.mutate({
            outcome,
            ...(needsReason(outcome) ? { reason: reason.trim() } : {}),
            by_name: byName.trim(),
            ...(byTitle.trim() ? { by_title: byTitle.trim() } : {}),
            evidence: evidence
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean)
              .map((name) => ({ name })),
          });
      }}
    >
      <label className="grid gap-1">
        {t("contracts.partner.record.outcome")}
        <select
          className="field h-9"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as Outcome)}
        >
          <option value="confirmed">{t("contracts.partner.out.opt.confirmed")}</option>
          <option value="returned">{t("contracts.partner.out.opt.returned")}</option>
          <option value="declined">{t("contracts.partner.out.opt.declined")}</option>
        </select>
      </label>
      {needsReason(outcome) && (
        <label className="grid gap-1">
          {t("contracts.partner.record.reason")}
          <input
            className="field h-9"
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1">
          {t("contracts.partner.record.byName")}
          <input
            className="field h-9"
            maxLength={200}
            value={byName}
            onChange={(e) => setByName(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          {t("contracts.partner.record.byTitle")}
          <input
            className="field h-9"
            maxLength={200}
            value={byTitle}
            onChange={(e) => setByTitle(e.target.value)}
          />
        </label>
      </div>
      <label className="grid gap-1">
        {t("contracts.partner.record.evidence")}
        <textarea
          className="field"
          rows={2}
          placeholder={t("contracts.partner.record.evidenceHint")}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      {m.error && (
        <p role="alert" className="text-late">
          {m.error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="btn btn-sm btn-primary"
          disabled={issue !== null || m.isPending}
          title={issue ? t(`contracts.partner.record.need.${issue}`) : undefined}
        >
          {t("contracts.partner.record.save")}
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onDone}>
          {t("contracts.partner.record.cancel")}
        </button>
      </div>
    </form>
  );
}

export function PartnerSendPanel({ id, write }: { id: string; write: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const q = useRounds(id);
  const rounds = q.data?.rounds ?? [];
  if (rounds.length === 0) return null;
  return (
    <section data-testid="partner-send-panel" className="mb-3 flex flex-col gap-2 text-sm">
      <b>{t("contracts.partner.out.title")}</b>
      <div className="flex flex-col gap-2">
        {rounds.map((r) => (
          <div key={r.mailbox_id}>
            <PartnerCard
              testId="partner-round"
              card={roundCard(r)}
              right={
                write && r.status === "open" ? (
                  <button
                    type="button"
                    data-testid="partner-record-open"
                    className="btn btn-sm btn-primary"
                    onClick={() => setOpen(r.mailbox_id)}
                  >
                    {t("contracts.partner.record.button")}
                  </button>
                ) : undefined
              }
            />
            {open === r.mailbox_id && <RecordForm round={r} onDone={() => setOpen(null)} />}
          </div>
        ))}
      </div>
    </section>
  );
}
