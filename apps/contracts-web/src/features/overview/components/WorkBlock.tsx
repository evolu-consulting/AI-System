// nav-v2 · khối "Cần xử lý" của Tổng quan = "Việc của tôi" cũ (cùng API `GET /pack/contracts/my-work`, cùng hàng + nút hành động):
// hiện 6 việc đầu (gấp nhất trước, máy chủ đã sắp), "Xem thêm n việc" mở hết. Chỉ việc người dùng THẤY (RLS) — API tự lọc.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { fetchMyWork, workKeys } from "~/features/mywork/api";
import { WorkRow } from "~/features/mywork/components/WorkRow";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { WORK_PREVIEW } from "../lib/overview";
import { BlockHead } from "./BlockHead";

export function WorkBlock({ today }: { today?: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: workKeys.all, queryFn: ({ signal }) => fetchMyWork(signal) });
  const items = q.data?.items ?? [];
  const shown = all ? items : items.slice(0, WORK_PREVIEW);
  const rest = items.length - WORK_PREVIEW;
  const late = q.data?.counts.late ?? 0;
  const body = () => {
    if (q.isLoading) return <Loading />;
    if (q.error) return <ErrorLine error={q.error} />;
    if (!items.length) return <Empty title={t("contracts.overview.work.empty")} />;
    return (
      <>
        <ul>
          {shown.map((i) => (
            <WorkRow key={i.id} i={i} today={today ?? ""} write={me.write} />
          ))}
        </ul>
        {rest > 0 && (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll(!all)}
            className="mx-5 my-3 text-label font-medium text-act underline underline-offset-2"
          >
            {all
              ? t("contracts.overview.work.less")
              : t("contracts.overview.work.more", { n: rest })}
          </button>
        )}
      </>
    );
  };
  return (
    <Panel>
      <BlockHead
        title={t("contracts.overview.work.title")}
        meta={
          q.data && (
            <>
              {t("contracts.overview.work.count", { n: items.length })}
              {late > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-late">
                    {t("contracts.overview.work.late", { n: late })}
                  </span>
                </>
              )}
            </>
          )
        }
      />
      {body()}
      {q.data?.truncated && (
        <p role="status" className="px-5 pb-3 text-[13px] text-dim">
          {t("contracts.work.truncated")}
        </p>
      )}
    </Panel>
  );
}
