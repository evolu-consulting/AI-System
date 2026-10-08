// HUB-FR-96, HUB-FR-102 · chọn nhiều người từ danh bạ: `searchbox` + danh sách `checkbox` (mô tả = username). Không fetch trực tiếp.
import type { DirectoryUser } from "@ai/contracts/chat";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { useDebouncedValue } from "~/features/shell/hooks/use-debounced-value";
import { usePersonSearch } from "../hooks/use-person-search";

type Props = {
  selectedIds: ReadonlySet<string>;
  /** Người ẩn khỏi danh sách (chính mình). */
  excludeIds?: ReadonlySet<string>;
  /** Người đã trong nhóm: luôn hiện (kể cả khi không khớp ô tìm), `disabled` + nhãn `alreadyLabel`. */
  already?: Pick<DirectoryUser, "id" | "display_name" | "username">[];
  alreadyLabel?: string;
  /** Đạt trần: người chưa chọn bị vô hiệu. */
  full: boolean;
  onToggle: (user: DirectoryUser) => void;
  searchLabel: string;
};

const DEBOUNCE_MS = 250;
const SEARCH_MAX = 100;

type RowProps = {
  person: Pick<DirectoryUser, "display_name" | "username">;
  inputId: string;
  checked: boolean;
  disabled: boolean | undefined;
  note: string | undefined;
  onChange: () => void;
};

function PersonRow({ person, inputId, checked, disabled, note, onChange }: RowProps) {
  return (
    <li>
      <label
        htmlFor={inputId}
        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
      >
        <input
          id={inputId}
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          aria-label={person.display_name}
          aria-describedby={`${inputId}-u`}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{person.display_name}</span>
          <span id={`${inputId}-u`} className="truncate text-xs text-muted-foreground">
            @{person.username}
            {note ? ` · ${note}` : ""}
          </span>
        </span>
      </label>
    </li>
  );
}

export function PersonPicker({
  selectedIds,
  excludeIds,
  already,
  alreadyLabel,
  full,
  onToggle,
  searchLabel,
}: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, DEBOUNCE_MS).trim();
  const dir = usePersonSearch(dq);
  const listId = useId();
  const people = (dir.data?.items ?? []).filter((u) => u.active && !excludeIds?.has(u.id));
  const alreadyIds = already ? new Set(already.map((u) => u.id)) : undefined;
  const shown = new Set(people.map((u) => u.id));
  const pinned = (already ?? []).filter((u) => !shown.has(u.id));

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={q}
        maxLength={SEARCH_MAX}
        onChange={(e) => setQ(e.target.value)}
        className="h-9 bg-muted"
      />
      <div className="max-h-56 overflow-y-auto" aria-busy={dir.isFetching}>
        {dir.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        {dir.isError && (
          <p role="alert" className="py-2 text-sm">
            {t("directory.error")}
          </p>
        )}
        {dir.data && people.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">{t("directory.noMatch", { q: dq })}</p>
        )}
        <ul className="flex flex-col gap-0.5">
          {people.map((u) => (
            <PersonRow
              key={u.id}
              person={u}
              inputId={`${listId}-${u.id}`}
              checked={selectedIds.has(u.id)}
              disabled={alreadyIds?.has(u.id) || (!selectedIds.has(u.id) && full)}
              note={alreadyIds?.has(u.id) ? alreadyLabel : undefined}
              onChange={() => onToggle(u)}
            />
          ))}
          {pinned.map((u) => (
            <PersonRow
              key={u.id}
              person={u}
              inputId={`${listId}-${u.id}`}
              checked={false}
              disabled
              note={alreadyLabel}
              onChange={() => undefined}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
