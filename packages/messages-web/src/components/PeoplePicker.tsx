// CR-132 · W2 · chọn người nội bộ (dùng cho «Nhắn tin mới» và «Thêm người»): ô tìm + danh sách tích chọn; nói rõ khi đang tải / lỗi / rỗng.

import type { MsgPerson } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePeople } from "../hooks/use-conversations";
import { useDebounced } from "../hooks/use-debounced";
import type { CompanyFilter } from "../lib/company-filter";
import { filterPeople } from "../lib/people";
import { Skeleton } from "../ui";
import { LoadSentinel } from "./LoadSentinel";

export function PeoplePicker({
  enabled,
  selected,
  onToggle,
  disabledIds = [],
  company = "own",
}: {
  /** Chỉ tải danh bạ khi hộp đang mở. */
  enabled: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string, person: MsgPerson) => void;
  disabledIds?: readonly string[];
  /** CR-169 · `own` (mặc định, đồng nghiệp) hoặc id công ty đã kết nối (người của công ty đó: tên · chức vụ). */
  company?: CompanyFilter;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  // CR-148 · tải dần 30/lần; `q` lọc ở server, cuộn tới cuối (hoặc «Xem thêm») tải trang kế.
  const res = usePeople(enabled, dq, company);
  const people = res.items;
  const status = res.isPending ? "loading" : res.isError ? "error" : "ready";
  const shown = filterPeople(people, company === "own" ? q : "", disabledIds);
  const byId = new Map(people.map((x) => [x.id, x]));
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
            <button type="button" className="underline" onClick={() => void res.refetch()}>
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
                    onChange={() => {
                      const full = byId.get(p.id);
                      if (full) onToggle(p.id, full);
                    }}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">{p.name}</span>
                    {company !== "own" && byId.get(p.id)?.job_title && (
                      <span className="block truncate text-micro text-dim">
                        {byId.get(p.id)?.job_title}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {status === "ready" && res.hasNextPage && (
          <LoadSentinel loading={res.isFetchingNextPage} onMore={() => void res.fetchNextPage()} />
        )}
      </div>
    </div>
  );
}
