// CR-182 · «Thành viên của nhóm» trong khung giao việc: hiện NGAY khi chọn nhóm (trước khi lưu), avatar + chức vụ, tải dần («Xem thêm») nếu nhóm lớn.

import { Button } from "@ai/web-kit/ui/kit/button";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { usePeopleCards } from "~/features/contract-shared/people";
import { fetchGroupMembers } from "../api-roles";

const K = "contracts.flow.current.assign";
type Member = { id: string; name: string };

/** Một trang ⇒ MỘT lần lấy thẻ người (avatar + chức vụ) cho cả trang. */
function MemberRows({ items }: { items: readonly Member[] }) {
  const cards = usePeopleCards(items.map((m) => m.id));
  return (
    <>
      {items.map((m) => {
        const c = cards.get(m.id);
        return (
          <li key={m.id} className="flex min-h-8 items-center gap-2 text-body">
            <PersonAvatar name={m.name} id={m.id} src={c?.avatar} size={24} />
            <span className="min-w-0">
              <span className="block truncate">{m.name}</span>
              {c?.job_title && (
                <span className="block truncate text-dim text-xs">{c.job_title}</span>
              )}
            </span>
          </li>
        );
      })}
    </>
  );
}

export function GroupMembers({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const q = useInfiniteQuery({
    queryKey: ["flow-role", "group-members", groupId],
    queryFn: ({ pageParam, signal }) => fetchGroupMembers(groupId, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 30_000,
  });
  const pages = q.data?.pages ?? [];
  const count = pages.reduce((n, p) => n + p.items.length, 0);
  return (
    <section data-testid="assign-members">
      <h4 className="mb-1 text-label font-semibold">
        {t(q.hasNextPage ? `${K}.membersMore` : `${K}.members`, { count })}
      </h4>
      {q.isError ? (
        <p role="alert" className="text-caption text-late">
          {t(`${K}.membersFail`)}{" "}
          <Button variant="link" onClick={() => void q.refetch()}>
            {t("contracts.common.retry")}
          </Button>
        </p>
      ) : q.isPending ? (
        <p className="text-caption text-dim">{t("contracts.common.loading")}</p>
      ) : count === 0 ? (
        <p className="text-caption text-dim">{t(`${K}.noMembers`)}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {pages.map((p) => (
            <MemberRows key={p.items[0]?.id ?? "x"} items={p.items} />
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <Button
          variant="outline"
          className="mt-2"
          data-testid="assign-members-more"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {t(`${K}.loadMore`)}
        </Button>
      )}
    </section>
  );
}
