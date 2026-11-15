// CR-123 · u6 · FLOW3-FR-14 · một node module (Ký số = gửi + chờ ký xong) = MỘT dòng với trạng thái nghiệp vụ; hub đã gộp cụm stage.
import type { FlowStepView } from "@ai/contracts/flow";
import { useTranslation } from "react-i18next";

type Outcome = NonNullable<FlowStepView["outcome"]>;
const DOT: Record<Outcome, string> = {
  pending: "border-rule bg-transparent",
  skipped: "border-rule bg-sunk",
  waiting: "border-act bg-act-soft animate-pulse",
  done: "border-ok bg-ok",
  declined: "border-late bg-late",
  expired: "border-late bg-late",
  failed: "border-late bg-late",
};

export function ModuleStepRow({
  name,
  outcome,
  signer,
  node,
}: {
  name: string;
  outcome: Outcome;
  signer?: string | undefined;
  /** Khoá node module: bước «Gửi đối tác xác nhận» dùng chữ riêng (không nói "ký"). */
  node?: string | undefined;
}) {
  const kind = node === "contracts.partner-send" ? "partner" : "esign";
  const { t } = useTranslation();
  return (
    <li
      data-testid="approval-step-module"
      data-outcome={outcome}
      className={`flex gap-3 border-b border-rule-soft py-2 last:border-b-0 ${outcome === "skipped" ? "opacity-60" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border ${DOT[outcome]}`}
      />
      <div className="min-w-0 flex-1 text-sm">
        <b>{name}</b>
        <p
          className={
            outcome === "declined" || outcome === "expired" || outcome === "failed"
              ? "text-late"
              : "text-dim"
          }
          data-module="outcome"
        >
          {t(
            outcome === "skipped"
              ? "contracts.approval.module.outcome.skipped" // CR-174 · nhánh không đi vào: «Bỏ qua», không «đang chờ»
              : kind === "partner"
                ? `contracts.approval.module.partner.outcome.${outcome}`
                : outcome === "waiting"
                  ? "contracts.esign.pending" // một nhãn "Đang chờ ký" (CR-125 G6, #8)
                  : `contracts.approval.module.outcome.${outcome}`,
          )}
        </p>
        {signer && outcome !== "skipped" ? (
          <p className="text-caption text-dim" data-module="signer">
            {t("contracts.approval.module.signer", { who: signer })}
          </p>
        ) : null}
      </div>
    </li>
  );
}
