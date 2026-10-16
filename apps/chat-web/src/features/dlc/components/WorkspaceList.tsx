// DLC-R11 · mục sidebar "Workspaces": các hội thoại có dự án AI SDLC (tên dự án, trạng thái run) — bấm mở hội thoại đó.
import type { DlcWorkspace } from "@ai/contracts/chat";
import { useRouter } from "@tanstack/react-router";
import { FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useDlcWorkspaces } from "../hooks/use-dlc";
import { runStateTone } from "../lib/process-view";

type Props = { activeId: string | null; onNavigate?: () => void };

function Item({ w, active, onOpen }: { w: DlcWorkspace; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sidebar-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-accent text-accent-foreground",
        )}
      >
        <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{w.project ?? w.title}</span>
          <span className="truncate text-xs text-muted-foreground">{w.title}</span>
        </span>
        {w.run_state && (
          <span
            className={cn("size-2 shrink-0 rounded-full", runStateTone(w.run_state))}
            title={w.run_state}
          />
        )}
      </button>
    </li>
  );
}

export function WorkspaceList({ activeId, onNavigate }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useDlcWorkspaces();
  if (q.isPending) return <Skeleton className="mx-1 h-9" />;
  const items = q.data?.items ?? [];
  if (items.length === 0)
    return <p className="px-2.5 py-2 text-sm text-muted-foreground">{t("dlc.workspacesEmpty")}</p>;
  const open = (id: string) => {
    void router.navigate({ to: "/c/$id", params: { id } });
    onNavigate?.();
  };
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((w) => (
        <Item
          key={w.conversation_id}
          w={w}
          active={w.conversation_id === activeId}
          onOpen={() => open(w.conversation_id)}
        />
      ))}
    </ul>
  );
}
