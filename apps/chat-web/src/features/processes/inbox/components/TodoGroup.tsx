// CHAT-AC-54 · FD8 · PF3: "Chờ tôi kiểm" — `SidebarGroup` trên cùng (luôn hiện khi engine on). Mục → `/runs/$id?task=`.
// Huy hiệu = `open_count`. `review_task.closed` (realtime, B0) invalidate `processKeys.tasks` ⇒ mục biến mất không reload.
import type { ReviewTaskListItem } from "@ai/contracts/chat";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { SidebarGroup } from "~/features/shell/components/SidebarGroup";
import { relativeTime } from "~/features/thread/lib/thread-logic";
import { useReviewTasks } from "../api";
import { todoKindKey } from "../lib/notice";

const VISIBLE = 10;

function TodoItem({ item, now }: { item: ReviewTaskListItem; now: number }) {
  const { t, i18n } = useTranslation();
  const { task, process_run } = item;
  return (
    <li>
      <Link
        to="/runs/$id"
        params={{ id: process_run.id }}
        search={{ task: task.id }}
        className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate font-medium">
          {task.stage_name} · {process_run.process.name}
        </span>
        <span className="truncate text-caption text-muted-foreground">
          {t(todoKindKey(task.kind))} · {relativeTime(task.created_at, now, i18n.language)}
        </span>
      </Link>
    </li>
  );
}

export function TodoGroup() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const q = useReviewTasks();
  const items = q.data?.items ?? [];
  const now = Date.now();
  const shown = expanded ? items : items.slice(0, VISIBLE);

  return (
    <div className="mb-1">
      <SidebarGroup
        id="process-todo"
        title={t("process.inbox.todo.title")}
        unread={q.data?.open_count ?? 0}
        badgeTestId="process-todo-badge"
      >
        {q.isPending ? (
          <div className="flex flex-col gap-1 px-2 py-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : q.isError ? (
          <p className="px-2 py-1 text-caption text-destructive">
            {t("process.inbox.todo.error")}{" "}
            <button type="button" className="underline" onClick={() => void q.refetch()}>
              {t("process.common.error.retry")}
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="px-2 py-1 text-caption text-muted-foreground">
            {t("process.inbox.todo.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((it) => (
              <TodoItem key={it.task.id} item={it} now={now} />
            ))}
            {!expanded && items.length > VISIBLE && (
              <li>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1 text-left text-caption text-muted-foreground underline hover:text-foreground"
                  onClick={() => setExpanded(true)}
                >
                  {t("process.inbox.todo.more")}
                </button>
              </li>
            )}
          </ul>
        )}
      </SidebarGroup>
    </div>
  );
}
