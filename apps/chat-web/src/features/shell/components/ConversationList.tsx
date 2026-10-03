// CHAT-AC-19, CHAT-AC-21, CHAT-AC-22 · danh sách nhóm theo thời gian + tìm + tải thêm; trạng thái tải / rỗng / không khớp / lỗi.
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  useConversationList,
  useDeleteConversation,
  useRenameConversation,
} from "~/features/conversations/hooks/use-conversations";
import { groupByTime } from "~/lib/time-groups";
import { conversationPath } from "../lib/conversation-path";
import { ConversationItem } from "./ConversationItem";

type Props = {
  /** Từ khoá đã debounce. */
  q: string;
  activeId: string | null;
  /** Gọi sau khi chọn một hội thoại (đóng Sheet). */
  onNavigate?: () => void;
};

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"];

export function ConversationList({ q, activeId, onNavigate }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const list = useConversationList(q);
  const rename = useRenameConversation();
  const remove = useDeleteConversation();

  const open = (id: string) => {
    void router.navigate({ to: conversationPath(id) as never });
    onNavigate?.();
  };
  const onRename = async (id: string, title: string) => {
    try {
      await rename.mutateAsync({ id, title });
    } catch (err) {
      toast.error(t("toast.renameFailed"));
      throw err;
    }
  };
  const onDelete = (id: string) =>
    remove.mutate(id, {
      onSuccess: () => {
        if (id === activeId) void router.navigate({ to: "/c/new" });
      },
      onError: () => toast.error(t("toast.deleteFailed")),
    });

  if (list.isPending) {
    return (
      <div className="flex flex-col gap-2 px-1" aria-busy="true">
        {SKELETON_ROWS.map((k) => (
          <Skeleton key={k} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (list.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 px-2.5 py-3 text-sm">
        <span>{t("sidebar.error")}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
          {t("sidebar.retry")}
        </Button>
      </div>
    );
  }
  if (list.items.length === 0) {
    return (
      <p className="px-2.5 py-3 text-sm text-muted-foreground">
        {q ? t("sidebar.noMatch", { q }) : t("sidebar.empty")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {groupByTime(list.items, Date.now()).map(({ group, items }) => (
        <section key={group} className="flex flex-col gap-0.5">
          <h2 className="px-2 pt-2 text-xs font-semibold text-muted-foreground">
            {t(`group.${group}`)}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {items.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                onOpen={open}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ))}
      {list.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t("sidebar.loadMore")}
        </Button>
      )}
    </div>
  );
}
