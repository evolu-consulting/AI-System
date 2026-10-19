// HD7-FR-08 · HD7-FR-12 · "Ghi việc khác" — port `PartnerLog.tsx:177-208`: giao hàng (NCC, số ngày trễ), khiếu nại (bắt buộc nội
// dung), giữ/lỡ hẹn; ngày ≤ hôm nay; ghi xong xoá ghi chú + số ngày trễ.
import type { PartnerRole } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { recordEvent } from "../api";
import { otherKinds, today } from "../lib/ledger";
import type { Act } from "../lib/use-act";

type Props = {
  party: string;
  role: PartnerRole;
  contractId?: string;
  busy: string | null;
  act: Act;
};

export function OtherForm({ party, role, contractId, busy, act }: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.ledger.${k}`);
  const kinds = otherKinds(role);
  const [type, setType] = useState(kinds[0]?.type ?? "complaint");
  const [at, setAt] = useState(today());
  const [late, setLate] = useState(0);
  const [note, setNote] = useState("");
  const kind = kinds.find((k) => k.type === type);
  const save = () =>
    act(
      "other",
      () =>
        recordEvent({
          party,
          role,
          type,
          at,
          note: note.trim() || undefined,
          days_late: kind?.late ? late : undefined,
          contract_id: contractId,
        }),
      L("toast.other"),
    ).then((ok) => {
      if (ok) {
        setNote("");
        setLate(0);
      }
    });
  return (
    <div>
      <h3 className="mb-1.5 text-[14px] font-semibold">{L("otherTitle")}</h3>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <select
          className="field h-8 w-auto"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label={L("kind")}
        >
          {kinds.map((k) => (
            <option key={k.type} value={k.type}>
              {L(`other.${k.type}`)}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="field h-8 w-[150px]"
          value={at}
          max={today()}
          onChange={(e) => setAt(e.target.value)}
          aria-label={L("date")}
        />
        {kind?.late && (
          <label className="flex items-center gap-1.5">
            {L("late")}
            <input
              className="field h-8 w-[56px] text-right font-mono"
              inputMode="numeric"
              value={late}
              onChange={(e) => setLate(Number(e.target.value.replace(/\D/g, "")) || 0)}
              aria-label={L("lateAria")}
            />{" "}
            {L("days")}
          </label>
        )}
        <input
          className="field h-8 min-w-[180px] flex-1"
          placeholder={type === "complaint" ? L("complaintNote") : L("notePlaceholder")}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          aria-label={L("noteAria")}
        />
        <button
          type="button"
          className="btn btn-primary h-8"
          disabled={!!busy || (type === "complaint" && !note.trim())}
          onClick={() => void save()}
        >
          {busy === "other" ? L("saving") : L("save")}
        </button>
      </div>
    </div>
  );
}
