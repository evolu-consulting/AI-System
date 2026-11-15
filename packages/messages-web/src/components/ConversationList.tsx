// CR-132 · W2 · danh sách hội thoại (trình bày, không gọi mạng — dùng chung toàn màn và khoang hẹp ở W3): ô lọc, nút «Nhắn tin mới».
// CR-148: «Thành viên» chia nhóm theo phòng ban (thu gọn/mở, nhớ trong phiên; không phòng ⇒ «Chưa có phòng»), mọi phần tải dần 30/lần.
// CR-132b: hai mục «Nhóm» (nhóm mình ở trong) và «Thành viên» (đồng nghiệp cùng công ty; có 1-1 thì mang xem trước/chưa đọc, chưa có thì bấm là mở).
// Trạng thái: đang tải · lỗi · rỗng · không khớp.

import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { readCollapsed, toggleCollapsed, writeCollapsed } from "../lib/collapse";
import { buildDirectory, type DeptSection, type Directory } from "../lib/directory";
import type { Person } from "../lib/people";
import { Skeleton } from "../ui";
import { ConversationRow } from "./ConversationRow";
import { LoadSentinel } from "./LoadSentinel";

export type ConversationListProps = {
  items: readonly ConversationSummary[];
  people: readonly Person[];
  /** Thẻ người đã đọc theo lô (avatar, phòng ban). */
  cards: ReadonlyMap<string, PersonCard>;
  /** Ô tìm do cha giữ (lọc ở server cho danh bạ). */
  q: string;
  onQ: (q: string) => void;
  peopleHasMore: boolean;
  peopleLoadingMore: boolean;
  onMorePeople: () => void;
  myId: string;
  activeId: string | null;
  status: "loading" | "error" | "ready";
  hasMore: boolean;
  loadingMore: boolean;
  /** Người đang được mở 1-1 (khoá dòng trong lúc tạo). */
  openingId: string | null;
  onSelect: (id: string) => void;
  onPickPerson: (userId: string) => void;
  onNew: () => void;
  onMore: () => void;
  onRetry: () => void;
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <h3 className="m-0 px-4 pb-1 pt-3 text-micro font-semibold uppercase tracking-wide text-dim">
        {label}
      </h3>
      {children}
    </section>
  );
}

/** Một phòng ban: tiêu đề bấm thu gọn/mở (aria-expanded), đếm người đã tải. */
function DeptGroup({
  s,
  p,
  open,
  onToggle,
}: {
  s: DeptSection;
  p: ConversationListProps;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const name = s.name ?? t("contracts.messages.noDept");
  return (
    <div data-testid="dept-group" data-dept={s.key}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-label font-semibold text-dim hover:bg-sunk focus-visible:bg-sunk focus-visible:outline-none"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 font-normal">{s.rows.length}</span>
      </button>
      {open && (
        <ul className="m-0 list-none p-0">
          {s.rows.map(({ person, conv }) => (
            <ConversationRow
              key={person.id}
              c={conv}
              name={person.name}
              myId={p.myId}
              card={p.cards.get(conv?.peer?.id ?? person.id)}
              active={conv !== null && conv.id === p.activeId}
              busy={p.openingId === person.id}
              onOpen={() => (conv ? p.onSelect(conv.id) : p.onPickPerson(person.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DirectorySections({ p, dir }: { p: ConversationListProps; dir: Directory }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => readCollapsed());
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const n = toggleCollapsed(c, key);
      writeCollapsed(n);
      return n;
    });
  return (
    <>
      <Section label={t("contracts.messages.groups")}>
        <ul className="m-0 list-none p-0">
          {dir.groups.length === 0 ? (
            <li className="px-4 py-2 text-label text-dim">{t("contracts.messages.groupsEmpty")}</li>
          ) : (
            dir.groups.map((c) => (
              <ConversationRow
                key={c.id}
                c={c}
                myId={p.myId}
                active={c.id === p.activeId}
                onOpen={() => p.onSelect(c.id)}
              />
            ))
          )}
        </ul>
        {p.hasMore && <LoadSentinel loading={p.loadingMore} onMore={p.onMore} />}
      </Section>
      <Section label={t("contracts.messages.membersSection")}>
        {dir.sections.map((s) => (
          <DeptGroup
            key={s.key}
            s={s}
            p={p}
            open={!collapsed.has(s.key) || p.q.trim() !== ""}
            onToggle={() => toggle(s.key)}
          />
        ))}
        {p.peopleHasMore && <LoadSentinel loading={p.peopleLoadingMore} onMore={p.onMorePeople} />}
      </Section>
    </>
  );
}

export function ConversationList(p: ConversationListProps) {
  const { t } = useTranslation();
  const dir = buildDirectory(p.items, p.people, p.q, (id) => p.cards.get(id)?.department);
  const newBtn = (
    <button type="button" onClick={p.onNew} className="btn btn-primary btn-sm">
      {t("contracts.messages.newChat")}
    </button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="conv-list">
      <div className="flex shrink-0 items-center gap-2 px-3 py-3">
        <input
          type="search"
          value={p.q}
          onChange={(e) => p.onQ(e.target.value)}
          placeholder={t("contracts.messages.search")}
          aria-label={t("contracts.messages.search")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-field bg-panel px-3 text-[13.5px] outline-none focus-visible:border-act-line"
        />
        {newBtn}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.status === "loading" ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : p.status === "error" ? (
          <EmptyState
            kind="error"
            title={t("contracts.messages.loadError")}
            action={
              <button type="button" onClick={p.onRetry} className="btn btn-sm">
                {t("contracts.messages.retry")}
              </button>
            }
          />
        ) : p.items.length === 0 && p.people.length === 0 && p.q.trim() === "" ? (
          <EmptyState
            kind="empty"
            testId="conv-empty"
            title={t("contracts.messages.emptyList")}
            hint={t("contracts.messages.emptyListHint")}
            action={newBtn}
          />
        ) : dir.groups.length === 0 && dir.sections.length === 0 ? (
          <EmptyState
            kind="search"
            title={t("contracts.messages.noMatch")}
            hint={t("contracts.messages.noMatchHint")}
          />
        ) : (
          <DirectorySections p={p} dir={dir} />
        )}
      </div>
    </div>
  );
}
