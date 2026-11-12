// CR-132 · W2 · chọn người nội bộ (dùng cho «Nhắn tin mới» và «Thêm người»): ô tìm + danh sách tích chọn; nói rõ khi đang tải / lỗi / rỗng.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { filterPeople, type Person } from "../lib/people";

export function PeoplePicker({
  people,
  status,
  selected,
  onToggle,
  onRetry,
  disabledIds = [],
}: {
  people: readonly Person[];
  status: "loading" | "error" | "ready";
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onRetry: () => void;
  disabledIds?: readonly string[];
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const shown = filterPeople(people, q, disabledIds);
  return (
    <div className="min-w-0">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("contracts.messages.searchPeople")}
        aria-label={t("contracts.messages.searchPeople")}
        className="mb-2 h-9 w-full rounded-lg border border-field bg-panel px-3 text-[13.5px] outline-none focus-visible:border-act-line"
      />
      <div className="max-h-64 overflow-y-auto rounded-lg border border-rule-soft">
        {status === "loading" ? (
          <Skeleton className="h-24 w-full" />
        ) : status === "error" ? (
          <p role="alert" className="m-0 p-3 text-label text-late">
            {t("contracts.messages.peopleError")}{" "}
            <button type="button" className="underline" onClick={onRetry}>
              {t("contracts.messages.retry")}
            </button>
          </p>
        ) : people.length === 0 ? (
          <p className="m-0 p-3 text-label text-dim">{t("contracts.messages.peopleEmpty")}</p>
        ) : shown.length === 0 ? (
          <p className="m-0 p-3 text-label text-dim">{t("contracts.messages.peopleNone")}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {shown.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-sunk">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => onToggle(p.id)}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
