// V2-I · DT-02/03 · tab Tổng quan: bảng tính điểm từng nhóm (bấm tiêu chí ⇒ các việc), các bước tới điểm cuối, biểu đồ 3/6/12 tháng.
import type { RepRole } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { isNotFound, useRepConfig, useRepDetail } from "../hooks/use-partner-rep";
import type { Range } from "../lib/partner-v2";
import { FinalSteps } from "./FinalSteps";
import { HistoryChart } from "./HistoryChart";
import { RepBadge } from "./RepBadge";
import { RoleSeg } from "./RoleSeg";
import { ScoreTable } from "./ScoreTable";

export function OverviewTab({
  party,
  role,
  roles,
  range,
}: {
  party: string;
  role: RepRole;
  roles: readonly RepRole[];
  range: Range;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.${k}`, o);
  const d = useRepDetail(party, role);
  const cfg = useRepConfig();
  const body = () => {
    if (d.isLoading) return <Loading />;
    // 404 = đối tác chưa có việc/HĐ nào để chấm (nhãn MỚI) — không phải lỗi.
    if (isNotFound(d.error))
      return <p className="px-5 py-4 text-label text-dim">{L("noScoreYet")}</p>;
    if (d.error) return <ErrorLine error={d.error} />;
    const x = d.data;
    if (!x) return null;
    const share = cfg.data?.settings.manual_share ?? 20;
    return (
      <div className="space-y-4 px-5 pb-5">
        <div className="flex items-center gap-3">
          <RepBadge score={x.score} level={x.level} />
          <span className="text-[13.5px] text-dim">{L("jobsTotal", { n: x.jobs })}</span>
        </div>
        {x.groups.map((c) => (
          <div key={c.group} className="space-y-2">
            {x.groups.length > 1 && (
              <h4 className="text-[13.5px] font-semibold text-ink-2">{L(`group.${c.group}`)}</h4>
            )}
            <ScoreTable cell={c} items={x.items} />
          </div>
        ))}
        <FinalSteps cells={x.groups} roleScore={x.score} manualShare={share} />
      </div>
    );
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-label={L("scoreTitle")} className="rounded-xl border border-rule bg-panel">
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <h3 className="text-[15px] font-semibold">{L("scoreTitle")}</h3>
          <span className="ml-auto">
            <RoleSeg party={party} roles={roles} role={role} range={range} />
          </span>
        </div>
        {body()}
      </section>
      <HistoryChart party={party} role={role} range={range} />
    </div>
  );
}
