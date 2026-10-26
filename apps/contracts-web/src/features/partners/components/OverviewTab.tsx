// U3 · R44 · tab Tổng quan (engine HD8): huy hiệu theo vai (MỚI · tạm tính), lý do một dòng, bảng điểm từng tiêu chí (`/partners/score`),
// link "Cách tính điểm"; bên phải khối cờ đỏ (báo / gỡ).
import type { PartnerRole } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { isNotFound } from "../hooks/use-partner-rep";
import { usePartnerScore } from "../hooks/use-partner-scores";
import { badgeOf } from "../lib/partner-score";
import { FlagPanel } from "./FlagPanel";
import { RepBadge } from "./RepBadge";
import { RoleSeg } from "./RoleSeg";

const dash = "—";

function Breakdown({ party, role }: { party: string; role: PartnerRole }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.${k}`, o);
  const d = usePartnerScore(party, role);
  if (d.isLoading) return <Loading />;
  if (isNotFound(d.error))
    return <p className="px-5 py-4 text-label text-dim">{L("noScoreYet")}</p>;
  if (d.error) return <ErrorLine error={d.error} />;
  const x = d.data;
  if (!x) return null;
  const b = badgeOf(x);
  return (
    <div className="space-y-3 px-5 pb-5">
      <div className="flex flex-wrap items-center gap-3">
        <RepBadge row={x} />
        <span className="min-w-0 flex-1">
          {b.provisional && (
            <b className="block text-[13px] text-ink-2">
              {L("provisionalNote", { n: x.provisional_score })}
            </b>
          )}
          {b.level === "none" && <b className="block text-[13px] text-dim">{L("noData")}</b>}
          <span className="block text-[13.5px] text-dim">{x.reason}</span>
          <span className="block text-[13px] text-dim">
            {L("eventsN", { n: x.event_count })}
            {x.adjust ? ` · ${L("adjust", { n: x.adjust > 0 ? `+${x.adjust}` : x.adjust })}` : ""}
          </span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-dim">
              <th className="pb-1.5 font-medium">{L("table.criterion")}</th>
              <th className="pb-1.5 text-right font-medium">{L("table.score")}</th>
              <th className="pb-1.5 text-right font-medium">{L("table.data")}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(x.breakdown).map(([k, c]) => (
              <tr key={k} className="border-t border-rule-soft">
                <td className="py-2 pr-3 font-medium">{c.label}</td>
                <td className="tnum py-2 pr-3 text-right font-semibold">{c.value ?? dash}</td>
                <td className="py-2 text-right text-[13px] text-dim">
                  {c.detail ?? L("table.noData")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-dim">
        {L("howPre")}{" "}
        <Link
          to="/settings/scoring"
          className="font-semibold text-act underline underline-offset-2"
        >
          {L("howLink")}
        </Link>
      </p>
    </div>
  );
}

export function OverviewTab({
  party,
  role,
  roles,
}: {
  party: string;
  role: PartnerRole;
  roles: readonly PartnerRole[];
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.pv2.${k}`);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-label={L("scoreTitle")} className="rounded-xl border border-rule bg-panel">
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <h3 className="text-[15px] font-semibold">{L("scoreTitle")}</h3>
          <span className="ml-auto">
            <RoleSeg party={party} roles={roles} role={role} />
          </span>
        </div>
        <Breakdown party={party} role={role} />
      </section>
      <FlagPanel party={party} roles={roles} role={role} />
    </div>
  );
}
