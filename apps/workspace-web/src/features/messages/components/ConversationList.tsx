// CR-132 · W2 · danh sách hội thoại (trình bày, không gọi mạng — dùng chung toàn màn và khoang hẹp ở W3): ô lọc, nút «Nhắn tin mới».
// CR-132b: hai mục «Nhóm» (nhóm mình ở trong) và «Thành viên» (đồng nghiệp cùng công ty; có 1-1 thì mang xem trước/chưa đọc, chưa có thì bấm là mở).
// Trạng thái: đang tải · lỗi · rỗng · không khớp.
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { buildDirectory, type Directory } from "../lib/directory";
import type { Person } from "../lib/people";
import { ConversationRow } from "./ConversationRow";

export type ConversationListProps = {
  items: readonly ConversationSummary[];
  people: readonly Person[];
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
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}

function DirectorySections({ p, dir }: { p: ConversationListProps; dir: Directory }) {
  const { t } = useTranslation();
  return (
    <>
      <Section label={t("contracts.messages.groups")}>
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
      </Section>
      <Section label={t("contracts.messages.membersSection")}>
        {dir.members.map(({ person, conv }) => (
          <ConversationRow
            key={person.id}
            c={conv}
            name={person.name}
            myId={p.myId}
            active={conv !== null && conv.id === p.activeId}
            busy={p.openingId === person.id}
            onOpen={() => (conv ? p.onSelect(conv.id) : p.onPickPerson(person.id))}
          />
        ))}
      </Section>
    </>
  );
}

export function ConversationList(p: ConversationListProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const dir = buildDirectory(p.items, p.people, q);
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
          value={q}
          onChange={(e) => setQ(e.target.value)}
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
        ) : p.items.length === 0 && p.people.length === 0 ? (
          <EmptyState
            kind="empty"
            testId="conv-empty"
            title={t("contracts.messages.emptyList")}
            hint={t("contracts.messages.emptyListHint")}
            action={newBtn}
          />
        ) : dir.groups.length === 0 && dir.members.length === 0 ? (
          <EmptyState
            kind="search"
            title={t("contracts.messages.noMatch")}
            hint={t("contracts.messages.noMatchHint")}
          />
        ) : (
          <DirectorySections p={p} dir={dir} />
        )}
        {p.status === "ready" && p.hasMore && (
          <div className="p-3 text-center">
            <button
              type="button"
              disabled={p.loadingMore}
              onClick={p.onMore}
              className="btn btn-sm"
            >
              {t("contracts.messages.loadMore")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
