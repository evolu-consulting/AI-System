// CR-132b + CR-148 · «Nhóm» + «Thành viên» (đồng nghiệp cùng công ty chia theo phòng ban, thu gọn/mở nhớ trong phiên, mọi phần tải dần 30/lần).
// CR-169 · lát 6 · tách khỏi `ConversationList`: chỉ dùng khi lọc «<Công ty mình>» (danh bạ nội bộ); «Tất cả»/công ty khác dùng danh sách gần đây.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { readCollapsed, toggleCollapsed, writeCollapsed } from "../lib/collapse";
import type { DeptSection, Directory } from "../lib/directory";
import { ConversationRow } from "./ConversationRow";
import { Section } from "./ListSection";
import { LoadSentinel } from "./LoadSentinel";
import type { ConversationListProps } from "./list-types";

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

export function DirectorySections({ p, dir }: { p: ConversationListProps; dir: Directory }) {
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
