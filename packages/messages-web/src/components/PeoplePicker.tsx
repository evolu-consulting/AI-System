// CR-132 · W2 · chọn người nội bộ (dùng cho «Nhắn tin mới» và «Thêm người»): ô tìm + danh sách tích chọn; nói rõ khi đang tải / lỗi / rỗng.

import type { MsgPerson } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePeople } from "../hooks/use-conversations";
import { useDebounced } from "../hooks/use-debounced";
import type { CompanyFilter } from "../lib/company-filter";
import { type DeptBlock, groupByDept } from "../lib/new-chat";
import { filterPeople } from "../lib/people";
import { Skeleton } from "../ui";
import { LoadSentinel } from "./LoadSentinel";

function PersonRows({
  blocks,
  selected,
  onToggle,
  dept,
}: {
  blocks: readonly DeptBlock[];
  selected: ReadonlySet<string>;
  onToggle: (id: string, person: MsgPerson) => void;
  /** Nội bộ ⇒ tiêu đề phòng ban; công ty khác ⇒ thêm chức vụ dưới tên. */
  dept: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div>
      {blocks.map((blk) => (
        <div key={blk.key} data-testid={dept ? "dept-group" : undefined}>
          {dept && (
            <p className="m-0 bg-sunk px-3 py-1 text-micro font-semibold text-dim">
              {blk.name ?? t("contracts.messages.noDept")}
            </p>
          )}
          <ul className="m-0 list-none p-0">
            {blk.people.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-sunk">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => onToggle(p.id, p)}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">{p.name}</span>
                    {!dept && p.job_title && (
                      <span className="block truncate text-micro text-dim">{p.job_title}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: một danh sách có 5 trạng thái (tải · lỗi · rỗng · không khớp · có người), tách thêm làm khó đọc
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
  const keep = new Set(shown.map((x) => x.id));
  const list = people.filter((x) => keep.has(x.id));
  // Nội bộ ⇒ theo phòng ban; công ty khác ⇒ một danh sách (tên · chức vụ).
  const blocks = company === "own" ? groupByDept(list) : [{ key: "all", name: null, people: list }];
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
          <PersonRows
            blocks={blocks}
            selected={selected}
            onToggle={onToggle}
            dept={company === "own"}
          />
        )}
        {status === "ready" && res.hasNextPage && (
          <LoadSentinel loading={res.isFetchingNextPage} onMore={() => void res.fetchNextPage()} />
        )}
      </div>
    </div>
  );
}
