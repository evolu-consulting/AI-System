// CR-126 · «Đã gửi của tôi» dưới danh sách loại yêu cầu: tên · ngày gửi · một nhóm trạng thái; bấm ⇒ trang yêu cầu.
import { useInfiniteQuery } from "@tanstack/react-query";
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
  // CR-151: tải dần theo trang 50 («Xem thêm»), không cắt im lặng.
  const q = useInfiniteQuery({
    queryKey: requestKeys.mine,
    queryFn: ({ pageParam, signal }) => fetchMyRequests(pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    staleTime: 15_000,
  });
  if (q.isError || q.isPending) return null; // lỗi phụ không chặn danh sách loại yêu cầu
  const items = q.data.pages.flatMap((p) => p.items);
  return (
    <section data-testid="my-requests" className="mt-6">
      <h2 className="mb-2 text-[15px] font-semibold">{t("contracts.requests.mineTitle")}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-dim">{t("contracts.requests.mineEmpty")}</p>
      ) : (
        <Panel>
          <ul className="m-0 list-none p-0">
            {items.map((r) => (
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
          {q.hasNextPage && (
            <button
              type="button"
              data-testid="my-requests-more"
              disabled={q.isFetchingNextPage}
              className="w-full px-5 py-2 text-label text-dim underline"
              onClick={() => void q.fetchNextPage()}
            >
              {t("contracts.requests.mineMore")}
            </button>
          )}
        </Panel>
      )}
    </section>
  );
}
