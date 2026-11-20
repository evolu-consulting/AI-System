// CR-193 · danh sách thả «@» (BR-191-8): avatar, họ tên, chức vụ · công ty; ↑/↓ chọn, Enter/Tab nhận, Esc đóng. Neo vào khung cha `position: relative`.
import type { MentionablePerson } from "@ai/contracts/community";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { usePeopleCards } from "../application/use-people-cards";
import { t } from "../i18n";

export function MentionSuggest({
  id,
  people,
  state,
  index,
  onHover,
  onPick,
  placement = "above",
}: {
  id: string;
  people: MentionablePerson[];
  state: "loading" | "ok" | "error";
  index: number;
  onHover: (i: number) => void;
  onPick: (p: MentionablePerson) => void;
  placement?: "above" | "below";
}) {
  const cards = usePeopleCards(people.map((x) => x.userId));
  return (
    <div
      id={id}
      role="listbox"
      aria-label={t("community.draft.mentionSuggest")}
      data-testid="mention-suggest"
      className={`mpsuggest absolute inset-x-0 z-40 max-h-64 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-md ${placement === "above" ? "bottom-full mb-1" : "top-full mt-1"}`}
    >
      {state === "loading" && people.length === 0 && (
        <div className="fhint px-2 py-2">{t("community.draft.mentionLoading")}</div>
      )}
      {state === "error" && (
        <div className="fhint px-2 py-2">{t("community.draft.mentionError")}</div>
      )}
      {state === "ok" && people.length === 0 && (
        <div className="fhint px-2 py-2">{t("community.draft.mentionEmpty")}</div>
      )}
      {people.map((p, i) => (
        <div
          key={p.userId}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === index}
          data-testid="mention-option"
          tabIndex={-1}
          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 ${i === index ? "bg-muted" : ""}`}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // giữ con trỏ trong ô đang gõ
            onPick(p);
          }}
        >
          <PersonAvatar
            name={p.name}
            id={p.userId}
            src={cards.get(p.userId)?.avatar}
            size={32}
            interactive={false}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{p.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {[p.title, p.orgName ?? t("community.draft.mentionGroupInternal")]
                .filter(Boolean)
                .join(" · ")}
              {p.outside ? ` · ${t("community.draft.mentionOutside")}` : ""}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
