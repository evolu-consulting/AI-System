// HD7-FR-04…08 · HD7-FR-12 · "+ Ghi việc" với một đối tác — port `mgmt-app/web/src/pages/partners/PartnerLog.tsx:46-121`: lịch
// thanh toán (các đợt chưa xong), ghi việc khác, sổ đối tác "Đã ghi gần đây" (gồm dòng Quá hạn do hệ thống ghi, gạch dòng đã huỷ).
// Trên trang HĐ (`contractId`) chỉ đợt của HĐ đó. Viewer không thấy nút ghi.
import type { PartnerEvent, PartnerRole } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { viDate } from "~/components/shared/format";
import { ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { fetchInstalments, fetchPartnerEvents, ledgerKeys, voidEvent } from "../api";
import { answeredSet, recentOf, said, voidable } from "../lib/ledger";
import { type Act, useAct } from "../lib/use-act";
import { InstalmentRow } from "./InstalmentRow";
import { OtherForm } from "./OtherForm";

type Props = { party: string; role: PartnerRole; contractId?: string; onChange?: () => void };

function RecentLine({
  e,
  all,
  write,
  busy,
  act,
}: {
  e: PartnerEvent;
  all: Set<string | null>;
  write: boolean;
  busy: string | null;
  act: Act;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.ledger.${k}`, o);
  const answered = e.type === "overdue" && all.has(e.obligation_id);
  const red = e.type === "overdue" && !answered && e.party_late !== false;
  const who =
    e.source === "system"
      ? L("system")
      : e.source === "assistant"
        ? L("viaAssistant", { by: e.by_name ?? "" })
        : (e.by_name ?? "");
  const undo = async () => {
    const ok = await confirmDialog({
      title: L("voidTitle"),
      body: L("voidBody", { what: said(e, t), date: viDate(e.at) }),
      confirmLabel: L("voidConfirm"),
      danger: true,
    });
    if (ok) void act(`void:${e.id}`, () => voidEvent(e.id), L("toast.voided"));
  };
  return (
    <li
      className={`flex items-baseline gap-3 px-3 py-2 ${e.voided ? "text-dim line-through" : ""}`}
    >
      <span className="w-[82px] shrink-0 font-mono text-[12.5px] text-dim">{viDate(e.at)}</span>
      <span className={`min-w-0 flex-1 ${red ? "text-late" : ""}`}>
        {said(e, t, answered)}
        {e.note && <span className="text-dim"> · {e.note}</span>}
        <span className="block text-[12px] text-dim no-underline">
          {who}
          {e.voided ? L("voidedMark") : ""}
        </span>
      </span>
      {voidable(e, write) && (
        <button
          type="button"
          className="shrink-0 text-[12.5px] text-late hover:underline"
          disabled={!!busy}
          onClick={() => void undo()}
        >
          {L("void")}
        </button>
      )}
    </li>
  );
}

export function PartnerLog({ party, role, contractId, onChange }: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.ledger.${k}`);
  const { write } = useMe();
  const obs = useQuery({
    queryKey: ledgerKeys.instalments(party, contractId),
    queryFn: ({ signal }) => fetchInstalments(party, contractId, signal),
  });
  const evs = useQuery({
    queryKey: ledgerKeys.events(party),
    queryFn: ({ signal }) => fetchPartnerEvents(party, signal),
  });
  const { act, err, busy } = useAct(onChange);
  const all = evs.data ?? [];
  const answered = answeredSet(all);
  const recent = recentOf(all, contractId);
  const open = () => {
    if (obs.isLoading) return <Loading />;
    if (obs.error) return <ErrorLine error={obs.error} />;
    if (!obs.data?.length) return <p className="text-[13px] text-dim">{L("openEmpty")}</p>;
    return (
      <ul className="space-y-1.5">
        {obs.data.map((o) => (
          <InstalmentRow
            key={o.id}
            o={o}
            write={write}
            busy={busy}
            act={act}
            showContract={!contractId}
          />
        ))}
      </ul>
    );
  };
  return (
    <section className="space-y-3 text-sm" aria-label={L("aria")}>
      <div>
        <h3 className="mb-1.5 text-[14px] font-semibold">{L("openTitle")}</h3>
        {open()}
      </div>
      {write && (
        <OtherForm party={party} role={role} contractId={contractId} busy={busy} act={act} />
      )}
      {err && (
        <p role="alert" className="text-[12.5px] text-late">
          {err}
        </p>
      )}
      <div>
        <h3 className="mb-1.5 text-[14px] font-semibold">{L("recentTitle")}</h3>
        {evs.isLoading ? (
          <Loading />
        ) : !recent.length ? (
          <p className="text-[13px] text-dim">{L("recentEmpty")}</p>
        ) : (
          <ul className="divide-y divide-rule-soft rounded-lg border border-rule-soft">
            {recent.map((e) => (
              <RecentLine key={e.id} e={e} all={answered} write={write} busy={busy} act={act} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
