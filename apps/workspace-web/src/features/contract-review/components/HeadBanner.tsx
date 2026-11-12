// CR-127 · U5 · M10: MỘT băng lý do (trả lại · đang chờ · từ chối · tạm khoá · AI đang đọc/đọc lỗi · đối tác gửi chờ quyết) thay 6 dải cũ.
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { viDateTime } from "~/components/shared/format";
import { InboxDecisionRow } from "~/features/overview/components/InboxDecisionRow";
import { useMemberNames } from "../hooks/use-manage";
import { hoursLeft, lastDecision } from "../lib/head-banner";
import type { HeadBanner as Kind } from "../lib/head-rule";

const TONE: Record<string, string> = {
  returned: "border-soon-line bg-soon-bg",
  rejected: "border-late-line bg-late-bg",
  hold: "border-soon-line bg-soon-bg",
  readFailed: "border-late-line bg-late-bg",
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U5 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
export function HeadBanner({
  kind,
  c,
  partner,
}: {
  kind: Kind;
  c: ContractDetail;
  partner: string;
}) {
  const { t } = useTranslation();
  const name = useMemberNames();
  if (!kind || kind === "superseded") return null;
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.u5.banner.${k}`, o);
  const dec = lastDecision(c.events);
  const who = (id: string | null) => name(id) ?? t("contracts.work.u4.someone");
  let body: React.ReactNode = null;
  if (kind === "reading") body = L("reading");
  else if (kind === "readFailed") body = L("readFailed");
  else if (kind === "inbox")
    return (
      <div
        className="mb-4 rounded-xl border border-rule bg-panel"
        data-testid="head-banner"
        data-kind="inbox"
      >
        <InboxDecisionRow contractId={c.id} sender={partner || t("contracts.work.u4.someone")} />
      </div>
    );
  else if (kind === "returned" || kind === "rejected") {
    body = dec ? (
      <>
        <b>
          {L(
            dec.action === "reject"
              ? "rejectedBy"
              : dec.action === "withdraw"
                ? "withdrawnBy"
                : "returnedBy",
            { who: who(dec.by), at: viDateTime(dec.at) },
          )}
        </b>
        {dec.note && <span> · “{dec.note}”</span>}
        <span className="block text-caption text-dim">
          {L(kind === "rejected" ? "rejectedHint" : "returnedHint")}
        </span>
      </>
    ) : (
      L(kind === "rejected" ? "rejectedHint" : "returnedHint")
    );
  } else if (kind === "waiting") {
    const w = c.waiting;
    const h = hoursLeft(w?.due_at);
    body = w?.step ? (
      <>
        <b>{L("waiting", { step: w.step, who: w.who ?? "" })}</b>
        {h && <span> · {h.over ? L("over") : L("hoursLeft", { n: h.hours })}</span>}
        <span className="block text-caption text-dim">{L("waitingHint")}</span>
      </>
    ) : (
      L("waitingHint")
    );
  } else if (kind === "hold" && c.hold) {
    body = (
      <>
        <b>{L("holdBy", { who: who(c.hold.by) })}</b>
        {c.hold.reason && <span> · “{c.hold.reason}”</span>}
        <span className="block text-caption text-dim">{L("holdHint")}</span>
      </>
    );
  }
  if (!body) return null;
  return (
    <div
      role="status"
      data-testid="head-banner"
      data-kind={kind}
      className={`mb-4 rounded-xl border px-4 py-3 text-[13.5px] ${TONE[kind] ?? "border-rule bg-panel"}`}
    >
      {body}
    </div>
  );
}
