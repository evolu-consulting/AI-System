// HUB-FR-102, HUB-FR-96 · kết quả tìm "Người" ở sidebar: bấm một người = mở DM (POST /rooms {kind:"dm"}).
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Skeleton } from "~/components/ui/skeleton";
import { usePersonSearch } from "~/features/directory/hooks/use-person-search";
import { useCreateRoom } from "~/features/rooms/hooks/use-room-actions";
import { roomErrorKeyOf } from "~/features/rooms/lib/room-errors";
import { useSession } from "~/lib/auth/use-session";
import { initialsOf } from "../lib/conversation-path";

type Props = { q: string; onNavigate?: () => void };

export function PeopleResults({ q, onNavigate }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const myId = useSession((s) => s.me?.id);
  const term = q.trim();
  const dir = usePersonSearch(term, term !== "");
  const create = useCreateRoom();
  if (term === "") return null;

  const people = (dir.data?.items ?? []).filter((u) => u.active && u.id !== myId);
  const open = (userId: string) =>
    create.mutate(
      { kind: "dm", user_id: userId },
      {
        onSuccess: (room) => {
          void router.navigate({ to: "/rooms/$id", params: { id: room.id } });
          onNavigate?.();
        },
        onError: (err) => toast.error(t(roomErrorKeyOf(err))),
      },
    );

  return (
    <section aria-labelledby="people-section-h" className="flex flex-col gap-0.5">
      <h3 id="people-section-h" className="px-2 pt-2 text-xs font-semibold text-muted-foreground">
        {t("directory.people")}
      </h3>
      {dir.isPending && (
        <div className="flex flex-col gap-2 px-1" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {dir.isError && (
        <p role="alert" className="px-2.5 py-2 text-sm">
          {t("directory.error")}
        </p>
      )}
      {dir.data && people.length === 0 && (
        <p className="px-2.5 py-2 text-sm text-muted-foreground">
          {t("directory.noMatch", { q: term })}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {people.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              aria-label={t("directory.messageTo", { name: u.display_name })}
              disabled={create.isPending}
              onClick={() => open(u.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
              >
                {initialsOf(u.display_name)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{u.display_name}</span>
                <span className="truncate text-xs text-muted-foreground">@{u.username}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
