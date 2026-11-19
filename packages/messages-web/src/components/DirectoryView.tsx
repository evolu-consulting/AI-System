// CR-190 · danh bạ nhóm (cột trái trang Tin nhắn): nhóm theo thứ tự cố định do máy chủ trả, mở/thu nhớ trên máy (xem `lib/collapse.ts`).
import type { MsgCompany, MsgDirPerson } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useTranslation } from "react-i18next";
import { isOpen, type OpenMap } from "../lib/collapse";
import type { DirData } from "../lib/directory";
import { DirGroup } from "./DirGroup";
import type { RowMenuHandlers } from "./RowMenu";

export type DirectoryViewProps = {
  data: DirData;
  /** Có chữ tìm ⇒ mọi nhóm còn dòng khớp đều mở. */
  searching: boolean;
  open: OpenMap;
  onToggle: (key: string, open: boolean) => void;
  myId: string;
  activeId: string | null;
  cards: ReadonlyMap<string, PersonCard>;
  loadingGroup: string | null;
  onMore: (groupKey: string, cursor: string) => void;
  openingId: string | null;
  onSelect: (id: string) => void;
  onPickPerson: (userId: string, company: MsgCompany) => void;
  menu: RowMenuHandlers;
};

export function DirectoryView(p: DirectoryViewProps) {
  const { t } = useTranslation();
  if (p.searching && p.data.groups.length === 0)
    return (
      <EmptyState
        kind="search"
        title={t("contracts.messages.noMatch")}
        hint={t("contracts.messages.noMatchHint")}
      />
    );
  return (
    <div data-testid="dir-list">
      {p.data.groups.map((g) => {
        const open = p.searching || isOpen(p.open, g.key, g.unread);
        return (
          <DirGroup
            key={g.key}
            group={g}
            open={open}
            onToggle={() => p.onToggle(g.key, !open)}
            myId={p.myId}
            activeId={p.activeId}
            cards={p.cards}
            loadingMore={p.loadingGroup === g.key}
            onMore={() => g.next_cursor && p.onMore(g.key, g.next_cursor)}
            openingId={p.openingId}
            onSelect={p.onSelect}
            onPickPerson={(x: MsgDirPerson) => p.onPickPerson(x.id, x.company)}
            menu={p.menu}
          />
        );
      })}
    </div>
  );
}
