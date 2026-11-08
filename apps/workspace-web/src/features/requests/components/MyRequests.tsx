// CR-126 · «Đã gửi của tôi» dưới danh sách loại yêu cầu: tên · ngày gửi · một nhóm trạng thái; bấm ⇒ trang yêu cầu.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { fetchMyRequests, requestKeys } from "../api";

const TONE = {
  waiting: "text-dim",
  done: "text-ok",
  returned: "text-body",
  rejected: "text-late",
} as const;

export function MyRequests() {
  const { t, i18n } = useTranslation();
  const q = useQuery({
    queryKey: requestKeys.mine,
    queryFn: ({ signal }) => fetchMyRequests(signal),
    staleTime: 15_000,
  });
  if (q.isError || q.isPending) return null; // lỗi phụ không chặn danh sách loại yêu cầu
  return (
    <section data-testid="my-requests" className="mt-6">
      <h2 className="mb-2 text-[15px] font-semibold">{t("contracts.requests.mineTitle")}</h2>
      {q.data.items.length === 0 ? (
        <p className="text-sm text-dim">{t("contracts.requests.mineEmpty")}</p>
      ) : (
        <Panel>
          <ul className="m-0 list-none p-0">
            {q.data.items.map((r) => (
              <li key={r.run_id} className="border-b border-rule-soft last:border-b-0">
                <Link
                  to="/contracts/requests/$runId"
                  params={{ runId: r.run_id }}
                  data-testid="my-request"
                  className="flex min-w-0 items-center gap-3 px-5 py-3 max-sm:px-4"
                >
                  <b className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{r.title}</b>
                  <span className="shrink-0 text-label text-dim">
                    {new Date(r.created_at).toLocaleDateString(i18n.language)}
                  </span>
                  <span className={`shrink-0 text-label ${TONE[r.word]}`}>
                    {r.word === "waiting" && r.waiting_for
                      ? t("contracts.requests.mineWaitingFor", { who: r.waiting_for })
                      : t(`contracts.requests.mine.${r.word}`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  );
}
