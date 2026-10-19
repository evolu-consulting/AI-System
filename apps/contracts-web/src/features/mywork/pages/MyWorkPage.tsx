// W1 · /my-work "Việc của tôi": việc cần làm của riêng người dùng — hẹn nhắc, tiền tới hạn/trễ, hạn xử lý HĐ, nhắc hạn đã gửi.
// mgmt-app không có màn riêng (việc nằm ở thẻ đầu trợ lý, `digest.py`) ⇒ màn thiết kế theo khung contracts-web: 3 ô số, chip lọc, danh sách nhóm.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHead, Panel, Stat } from "~/components/shared/layout";
import { Chips, Empty, ErrorLine, Loading } from "~/components/shared/states";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { fetchMyWork, workKeys } from "../api";
import { WorkRow } from "../components/WorkRow";
import { countByKind, FILTERS, type Filter, filterItems, GROUPS, groupOf } from "../lib/mywork";

export function MyWorkPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [f, setF] = useState<Filter>("all");
  const q = useQuery({ queryKey: workKeys.all, queryFn: ({ signal }) => fetchMyWork(signal) });
  const data = q.data;
  const n = countByKind(data?.items ?? []);
  const shown = filterItems(data?.items ?? [], f);
  const body = () => {
    if (q.isLoading) return <Loading />;
    if (q.error) return <ErrorLine error={q.error} />;
    if (!shown.length)
      return <Empty title={t("contracts.work.emptyTitle")}>{t("contracts.work.emptyBody")}</Empty>;
    return GROUPS.map((g) => {
      const rows = shown.filter((i) => groupOf(i) === g);
      return (
        rows.length > 0 && (
          <section key={g} aria-label={t(`contracts.work.group.${g}`)}>
            <h2 className="bg-sunk px-5 py-2 text-xs font-semibold text-dim max-sm:px-4">
              {t(`contracts.work.group.${g}`)} · {rows.length}
            </h2>
            <ul>
              {rows.map((i) => (
                <WorkRow key={i.id} i={i} today={data?.today ?? ""} write={me.write} />
              ))}
            </ul>
          </section>
        )
      );
    });
  };
  return (
    <div className="text-base leading-[1.55]">
      <PageHead title={t("contracts.work.title.page")} lead={t("contracts.work.lead")} />
      <div className="mb-5 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        <Stat
          loading={q.isLoading}
          value={data?.counts.late ?? 0}
          label={t("contracts.work.group.late")}
          tone="late"
        />
        <Stat
          loading={q.isLoading}
          value={data?.counts.today ?? 0}
          label={t("contracts.work.group.today")}
          tone="soon"
        />
        <Stat
          loading={q.isLoading}
          value={data?.counts.upcoming ?? 0}
          label={t("contracts.work.group.upcoming")}
        />
      </div>
      <Chips
        label={t("contracts.work.filter")}
        value={f}
        onChange={setF}
        items={FILTERS.map((k) => ({
          id: k,
          label: `${t(`contracts.work.filters.${k}`)} (${n[k]})`,
        }))}
      />
      <Panel>{body()}</Panel>
      {data?.truncated && (
        <p role="status" className="mt-3 text-[13px] text-dim">
          {t("contracts.work.truncated")}
        </p>
      )}
    </div>
  );
}
