// esign-flow · dòng "Ký số" cuối tiến trình duyệt: chờ duyệt xong / đang gửi / đã gửi chờ ký / đã ký xong / cần xử lý (lý do + cách sửa)
// + "Gửi lại" cho người phụ trách HĐ (hoặc mở lại HĐ ở trang chi tiết). esign-sweep2 · "Hạn ký", nhãn "Quá hạn", "Đã nhắc lúc".
// CR-123 U2 · 3 dòng trạng thái · lý do · bước kế (`card-status.ts`).
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { viDateTime } from "~/components/shared/format";
import { toast } from "~/components/shared/toast";
import { approvalKey, resendEsignStep } from "../hooks/use-approval-api";
import { esignStatusLines } from "../lib/card-status";
import { StatusLines } from "./StatusLines";

type Esign = NonNullable<ContractApproval["esign"]>;
const DOT: Record<Esign["status"], string> = {
  pending: "border-rule bg-transparent",
  sending: "border-act bg-act-soft animate-pulse",
  sent: "border-act bg-act",
  completed: "border-ok bg-ok",
  needs_decision: "border-late bg-late",
};

/** esign-sweep2 · mốc giờ (ISO từ server) theo giờ máy người xem. */
const when = (iso: string) => viDateTime(iso);

export function EsignStepRow({ id, e }: { id: string; e: Esign }) {
  const { t } = useTranslation();
  const k = (s: string) => t(`contracts.approval.esign.${s}`);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => resendEsignStep(id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: approvalKey(id) });
      toast(
        k(r.result === "sent" ? "resent" : "stillBlocked"),
        r.result === "sent" ? undefined : "late",
      );
    },
    onError: () => toast(k("resendFail"), "late"),
  });
  return (
    <li
      data-testid="approval-step-esign"
      data-status={e.status}
      className="flex gap-3 border-b border-rule-soft py-2 last:border-b-0"
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border ${DOT[e.status]}`}
      />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-2">
          <b>{e.name}</b>
        </div>
        <StatusLines lines={esignStatusLines(e)} alert={e.status === "needs_decision"} />
        {(e.due_at || e.reminded_at) && (
          <div className="flex flex-wrap items-center gap-x-2 text-caption text-dim">
            {e.due_at && (
              <span data-esign="due-at">
                {t("contracts.approval.esign.dueAt", { at: when(e.due_at) })}
              </span>
            )}
            {e.overdue && (
              <span
                data-esign="overdue"
                className="rounded border border-late px-1 font-medium text-late"
              >
                {k("overdue")}
              </span>
            )}
            {e.reminded_at && (
              <span data-esign="reminded-at">
                {t("contracts.approval.esign.remindedAt", { at: when(e.reminded_at) })}
              </span>
            )}
          </div>
        )}
        {e.can_resend && (
          <button
            type="button"
            data-approval="esign-resend"
            className="mt-1 h-8 rounded-lg border border-rule px-2 text-label hover:bg-sunk disabled:opacity-50"
            disabled={m.isPending}
            onClick={() => m.mutate()}
          >
            {k("resend")}
          </button>
        )}
      </div>
    </li>
  );
}
