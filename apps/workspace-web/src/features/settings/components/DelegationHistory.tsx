// CR-184 · «Lịch sử uỷ quyền» (thu gọn, tải dần): ai vắng → giao ai · ngày – ngày · loại việc · ai đặt (khi đặt thay) · trạng thái
// (còn hiệu lực / hết hạn / đã thu hồi + ai thu hồi, lúc nào) · số việc đã làm thay (bấm ⇒ danh sách việc, mở hợp đồng).
import type { DelegationHistoryItem } from "@ai/contracts/chat";
import { Avatar } from "@ai/web-kit/ui/kit/avatar";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai/web-kit/ui/kit/collapsible";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePeopleCards } from "~/features/contract-shared/people";
import { delegationKeys, fetchDelegationHistory, fetchDelegationWork } from "../api-delegation";

const day = (iso: string, end = false) =>
  new Date(Date.parse(iso) - (end ? 1 : 0)).toLocaleDateString("vi-VN");
const at = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });

type Scope = { tenantId: string | null; admin: boolean };

function WorkList({ d, s }: { d: DelegationHistoryItem } & { s: Scope }) {
  const { t } = useTranslation();
  const q = useInfiniteQuery({
    queryKey: [...delegationKeys.history, "work", d.id],
    queryFn: ({ pageParam, signal }) =>
      fetchDelegationWork(s.tenantId, s.admin, d.id, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (l) => l.next_offset ?? undefined,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  if (q.isPending)
    return <p className="m-0 py-2 text-dim text-sm">{t("contracts.paging.loading")}</p>;
  return (
    <ul className="m-0 list-none py-1 pl-6" data-testid="delegation-work">
      {items.map((w) => (
        <li key={w.task_id} className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
          {w.pack_key === "contracts" && w.pack_record_id ? (
            <Link to="/contracts/c/$id" params={{ id: w.pack_record_id }} className="underline">
              {w.stage_name ?? t("contracts.work.u4.deleg.history.contract")}
            </Link>
          ) : (
            <span>{w.stage_name ?? t("contracts.work.u4.deleg.history.task")}</span>
          )}
          <span className="text-dim">· {at(w.decided_at)}</span>
        </li>
      ))}
      {q.hasNextPage && (
        <li>
          <Button
            variant="quiet"
            size="sm"
            className="max-sm:min-h-11"
            onClick={() => void q.fetchNextPage()}
          >
            {t("contracts.paging.more")}
          </Button>
        </li>
      )}
    </ul>
  );
}

function Row({
  d,
  s,
  avatar,
}: {
  d: DelegationHistoryItem;
  s: Scope;
  avatar: (id: string) => string | null | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const k = (key: string, o?: Record<string, unknown>) =>
    t(`contracts.work.u4.deleg.history.${key}`, o);
  const placedBy = d.created_by.id !== d.from_user.id ? d.created_by.display_name : null;
  return (
    <li
      className="border-b border-rule-soft py-2 last:border-b-0"
      data-testid="delegation-history-row"
      data-status={d.status}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <Avatar name={d.from_user.display_name} src={avatar(d.from_user.id)} size={24} />
          {d.from_user.display_name}
        </span>
        <span aria-hidden="true">→</span>
        <span className="inline-flex items-center gap-1.5">
          <Avatar name={d.to_user.display_name} src={avatar(d.to_user.id)} size={24} />
          {d.to_user.display_name}
        </span>
        <span className="text-dim">
          · {day(d.from_at)} – {day(d.to_at, true)} ·{" "}
          {d.kinds.map((x) => t(`contracts.work.u4.deleg.kind.${x}`)).join(", ")}
        </span>
      </div>
      <p className="m-0 mt-1 text-dim text-xs">
        <span data-testid="delegation-status">{k(`status.${d.status}`)}</span>
        {d.status === "revoked" &&
          ` · ${d.revoked_by ? k("revokedBy", { name: d.revoked_by.display_name }) : k("revokedUnknown")}${d.revoked_at ? ` · ${at(d.revoked_at)}` : ""}`}
        {placedBy && ` · ${k("placedBy", { name: placedBy })}`}
      </p>
      <Button
        variant="quiet"
        size="sm"
        className="max-sm:min-h-11"
        aria-expanded={open}
        disabled={d.done_count === 0}
        data-testid="delegation-done"
        onClick={() => setOpen(!open)}
      >
        {k("done", { count: d.done_count })}
      </Button>
      {open && d.done_count > 0 && <WorkList d={d} s={s} />}
    </li>
  );
}

export function DelegationHistory(s: Scope) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const q = useInfiniteQuery({
    queryKey: [...delegationKeys.history, s.tenantId, s.admin],
    queryFn: ({ pageParam, signal }) =>
      fetchDelegationHistory(s.tenantId, s.admin, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (l) => l.next_offset ?? undefined,
    enabled: open,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const cards = usePeopleCards(items.flatMap((d) => [d.from_user.id, d.to_user.id]));
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-rule-soft px-5 py-3">
      <CollapsibleTrigger
        className="flex min-h-11 items-center gap-2 font-semibold text-sm sm:min-h-8"
        data-testid="delegation-history-toggle"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {t("contracts.work.u4.deleg.history.title")}
      </CollapsibleTrigger>
      <CollapsibleContent data-testid="delegation-history">
        {q.isPending && open ? (
          <p className="m-0 py-2 text-dim text-sm">{t("contracts.paging.loading")}</p>
        ) : items.length === 0 ? (
          <p className="m-0 py-2 text-dim text-sm">{t("contracts.work.u4.deleg.history.empty")}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {items.map((d) => (
              <Row key={d.id} d={d} s={s} avatar={(id) => cards.get(id)?.avatar} />
            ))}
          </ul>
        )}
        {q.hasNextPage && (
          <Button
            variant="quiet"
            size="sm"
            className="max-sm:min-h-11"
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? t("contracts.paging.loading") : t("contracts.paging.more")}
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
