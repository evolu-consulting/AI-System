// CR-101 DOC-ui-frame · R5: dòng thời gian "Sửa trực tiếp" của giao dịch (máy ghi, không bắt lý do) từ `GET /contracts/:id/edit-log`.
import { Button } from "@ai/web-kit/ui/kit/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { editLogKey, fetchEditLog } from "../hooks/use-promote-api";
import { logRows } from "../lib/edit-log";

export function EditLogPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useInfiniteQuery({
    queryKey: [...editLogKey(id), "paged"],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchEditLog(id, pageParam, signal),
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
  const rows = logRows(q.data?.pages.flatMap((p) => p.items) ?? []);
  if (q.isLoading || q.error || rows.length === 0) return null;
  return (
    <Panel className="mt-4">
      <h2 className="border-b border-rule-soft px-5 py-3.5 text-[15px] font-semibold">
        {t("contracts.docframe.log.title")}
      </h2>
      <ul className="m-0 list-none px-5 py-3" data-testid="edit-log">
        {rows.map((r) => (
          <li key={r.key} className="py-1.5 text-sm">
            <span className="text-dim">{r.at.slice(0, 16).replace("T", " ")} · </span>
            <b className="font-medium">
              {r.fieldKey ? t(`contracts.docframe.log.field.${r.fieldKey}`) : r.field}
            </b>
            : <span className="text-dim line-through">{r.from}</span> → <span>{r.to}</span>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <div className="border-t border-rule-soft px-5 py-2.5">
          <Button
            variant="link"
            className="h-auto px-0 text-dim"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {t("contracts.docframe.log.loadMore")}
          </Button>
        </div>
      )}
    </Panel>
  );
}
