// CR-190 · một nhóm của danh bạ trang Tin nhắn: đầu nhóm (mở/thu · tên · tổng người · chưa đọc) + dòng (15 đầu) + «Xem thêm (n)».
import type { MsgDirGroup, MsgDirPerson } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import { TruncText } from "@ai/web-kit/ui/kit/trunc-text";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronDown, IconChevronRight } from "../icons";
import { unreadLabel } from "../lib/conversations";
import { remaining } from "../lib/directory";
import { ConversationRow } from "./ConversationRow";
import type { RowMenuHandlers } from "./RowMenu";

export type DirGroupProps = {
  group: MsgDirGroup;
  open: boolean;
  onToggle: () => void;
  myId: string;
  activeId: string | null;
  cards: ReadonlyMap<string, PersonCard>;
  loadingMore: boolean;
  onMore: () => void;
  openingId: string | null;
  onSelect: (id: string) => void;
  onPickPerson: (person: MsgDirPerson) => void;
  menu: RowMenuHandlers;
};

/** Khoá dòng vừa nhảy lên ĐẦU nhóm (đã có trong nhóm trước đó) ⇒ chỉ dòng đó có chuyển động. */
function useBumpedKey(keys: readonly string[]): string | null {
  const prev = useRef<readonly string[]>(keys);
  const [bumped, setBumped] = useState<string | null>(null);
  const sig = keys.join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sig` đại diện cho `keys`
  useEffect(() => {
    const before = prev.current;
    prev.current = keys;
    const first = keys[0];
    setBumped(first && before[0] !== first && before.includes(first) ? first : null);
  }, [sig]);
  return bumped;
}

export function DirGroup(p: DirGroupProps) {
  const { t } = useTranslation();
  const g = p.group;
  const name =
    g.kind === "partner"
      ? (g.company?.name ?? "")
      : g.kind === "chat"
        ? t("contracts.messages.dirChat")
        : t("contracts.messages.dirInternal");
  const n = unreadLabel(g.unread);
  const left = remaining(g);
  const bumped = useBumpedKey(g.items.map((r) => r.key));
  return (
    <section data-testid="dir-group" data-group={g.key} aria-label={name}>
      <h3 className="m-0">
        <button
          type="button"
          data-testid="dir-group-head"
          aria-expanded={p.open}
          onClick={p.onToggle}
          className="flex w-full min-w-0 items-center gap-2 bg-sunk/60 px-3 py-2 text-left hover:bg-sunk focus-visible:bg-sunk focus-visible:outline-none"
        >
          {p.open ? (
            <IconChevronDown width={16} height={16} className="shrink-0 text-dim" />
          ) : (
            <IconChevronRight width={16} height={16} className="shrink-0 text-dim" />
          )}
          <TruncText
            text={name}
            focusable={false}
            className="min-w-0 flex-1 text-label font-semibold text-ink"
          />
          <span data-testid="dir-group-total" className="shrink-0 text-xs text-muted-foreground">
            {g.total}
          </span>
          {n && (
            <span
              data-testid="dir-group-unread"
              role="img"
              aria-label={t("contracts.messages.unread", { n: g.unread })}
              className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-late px-1 text-xs font-semibold text-panel"
            >
              {n}
            </span>
          )}
        </button>
      </h3>
      {p.open && (
        <>
          <ul className="m-0 list-none p-0">
            {g.items.map((r) => {
              const c = r.conversation;
              const person = r.person;
              return (
                <ConversationRow
                  key={r.key}
                  row={r}
                  showCompany={g.kind === "chat"}
                  myId={p.myId}
                  card={person ? p.cards.get(person.id) : undefined}
                  active={c !== null && c.id === p.activeId}
                  busy={person !== null && p.openingId === person.id}
                  bumped={bumped === r.key}
                  menu={p.menu}
                  onOpen={() => (c ? p.onSelect(c.id) : person && p.onPickPerson(person))}
                />
              );
            })}
          </ul>
          {g.items.length === 0 && (
            <p className="m-0 px-4 py-2 text-label text-dim">{t("contracts.messages.dirEmpty")}</p>
          )}
          {left > 0 && g.next_cursor && (
            <div className="px-3 py-1">
              <button
                type="button"
                data-testid="dir-more"
                disabled={p.loadingMore}
                onClick={p.onMore}
                className="h-8 w-full rounded-lg text-label font-medium text-act hover:bg-sunk max-sm:h-11"
              >
                {p.loadingMore
                  ? t("contracts.messages.loadingMore")
                  : t("contracts.messages.dirMore", { n: left })}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
