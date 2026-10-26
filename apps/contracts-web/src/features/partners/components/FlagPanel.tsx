// U3 · R39 · UT-FR-13: cờ đỏ của đối tác — danh sách việc nghiêm trọng (Không giao / Gian lận), nút "Báo cờ đỏ" (quyền ghi, lý do bắt buộc)
// qua `POST /partner-events`, nút "Gỡ cờ" (chỉ quản lý, lý do bắt buộc) qua `POST /partner-events/:id/void`. Cờ không đổi điểm.
import { type PartnerEvent, type PartnerRole, SEVERE_EVENT_TYPES } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { ErrorLine, Loading } from "~/components/shared/states";
import { fetchPartnerEvents, ledgerKeys } from "~/features/ledger/api";
import { useLedgerWrites } from "~/features/ledger/hooks/use-ledger";
import { useAskVoid } from "~/features/ledger/hooks/use-void";
import { isSevere, today } from "~/features/ledger/lib/ledger";
import { useAct } from "~/features/ledger/lib/use-act";
import { useMe } from "~/features/pack-state/hooks/use-me";

type SevereType = (typeof SEVERE_EVENT_TYPES)[number];

function Line({
  e,
  admin,
  busy,
  onVoid,
}: {
  e: PartnerEvent;
  admin: boolean;
  busy: boolean;
  onVoid: () => void;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.flag.${k}`, o);
  return (
    <li
      className={`flex items-baseline gap-3 px-3 py-2 ${e.voided ? "text-dim line-through" : ""}`}
    >
      <span className="w-[82px] shrink-0 font-mono text-[12.5px] text-dim">{viDate(e.at)}</span>
      <span className="min-w-0 flex-1">
        <b className={e.voided ? "" : "text-late"}>{L(`type.${e.type}`)}</b> ·{" "}
        {t(`contracts.pv2.roleWord.${e.role}`)}
        {e.note && <span className="block text-[13px] text-ink-2">{e.note}</span>}
        <span className="block text-[12px] text-dim no-underline">
          {e.by_name ?? ""}
          {e.voided ? L("voidedMark") : ""}
        </span>
      </span>
      {admin && !e.voided && (
        <button
          type="button"
          className="shrink-0 text-[12.5px] text-late hover:underline"
          disabled={busy}
          onClick={onVoid}
        >
          {L("clear")}
        </button>
      )}
    </li>
  );
}

function ReportForm({
  party,
  roles,
  role,
}: {
  party: string;
  roles: readonly PartnerRole[];
  role: PartnerRole;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.pv2.flag.${k}`);
  const { recordEvent } = useLedgerWrites();
  const { act, err, busy } = useAct();
  const [r, setR] = useState<PartnerRole>(role);
  const [type, setType] = useState<SevereType>("no_delivery");
  const [note, setNote] = useState("");
  const save = () =>
    act(
      "flag",
      () => recordEvent({ party, role: r, type, at: today(), note: note.trim() }),
      L("reported"),
    ).then((ok) => {
      if (ok) setNote("");
    });
  return (
    <div className="space-y-2 border-t border-rule-soft px-3 py-3 text-[13px]">
      <h4 className="text-[13.5px] font-semibold">{L("report")}</h4>
      <div className="flex flex-wrap gap-2">
        <select
          className="field h-8 w-auto"
          aria-label={L("kind")}
          value={type}
          onChange={(e) => setType(e.target.value as SevereType)}
        >
          {SEVERE_EVENT_TYPES.map((k) => (
            <option key={k} value={k}>
              {L(`type.${k}`)}
            </option>
          ))}
        </select>
        {roles.length > 1 && (
          <select
            className="field h-8 w-auto"
            aria-label={L("role")}
            value={r}
            onChange={(e) => setR(e.target.value as PartnerRole)}
          >
            {roles.map((x) => (
              <option key={x} value={x}>
                {t(`contracts.pv2.roleWord.${x}`)}
              </option>
            ))}
          </select>
        )}
        <input
          className="field h-8 min-w-[200px] flex-1"
          aria-label={L("reason")}
          placeholder={L("reasonPh")}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary h-8"
          disabled={!!busy || !note.trim()}
          onClick={() => void save()}
        >
          {busy === "flag" ? L("saving") : L("send")}
        </button>
      </div>
      {err && (
        <p role="alert" className="text-late">
          {err}
        </p>
      )}
    </div>
  );
}

export function FlagPanel({
  party,
  roles,
  role,
}: {
  party: string;
  roles: readonly PartnerRole[];
  role: PartnerRole;
}) {
  const { t } = useTranslation();
  const { write, owner } = useMe();
  const { act, err, busy } = useAct();
  const askVoid = useAskVoid(act);
  const q = useQuery({
    queryKey: ledgerKeys.events(party),
    queryFn: ({ signal }) => fetchPartnerEvents(party, signal),
  });
  const rows = (q.data ?? [])
    .filter((e) => isSevere(e.type))
    .slice()
    .reverse();
  const L = (k: string) => t(`contracts.pv2.flag.${k}`);
  return (
    <section
      aria-label={L("title")}
      className="rounded-xl border border-rule bg-panel"
      data-testid="flag-panel"
    >
      <div className="px-5 py-3">
        <h3 className="text-[15px] font-semibold">{L("title")}</h3>
        <p className="text-[13px] text-dim">{L("lead")}</p>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorLine error={q.error} />
      ) : rows.length === 0 ? (
        <p className="px-5 pb-4 text-label text-dim">{L("none")}</p>
      ) : (
        <ul className="divide-y divide-rule-soft border-t border-rule-soft">
          {rows.map((e) => (
            <Line
              key={e.id}
              e={e}
              admin={owner}
              busy={!!busy}
              onVoid={() => void askVoid(e.id, L(`type.${e.type}`), viDate(e.at))}
            />
          ))}
        </ul>
      )}
      {err && (
        <p role="alert" className="px-5 pb-3 text-[13px] text-late">
          {err}
        </p>
      )}
      {write && <ReportForm party={party} roles={roles} role={role} />}
    </section>
  );
}
