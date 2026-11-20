// CR-193 · chip «Đã nhắc» dưới thân bài (người chọn từ danh sách thả «@»); bấm × ⇒ bỏ nhắc.
import type { DraftMention } from "../domain/mention";
import { t } from "../i18n";
import { IconX } from "./icons";

export function MentionChips({
  mentions,
  onChange,
}: {
  mentions: DraftMention[];
  onChange: (m: DraftMention[]) => void;
}) {
  if (mentions.length === 0) return null;
  return (
    <div className="attachrow" data-testid="mention-people">
      <span className="fhint">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>{" "}
        {t("community.composer.mentioned")}:
      </span>
      {mentions.map((m) => (
        <span
          className="attach"
          key={m.userId}
          data-testid="mention-chip"
          style={{ background: "var(--accent-soft, #e8f0fe)", fontWeight: 600 }}
        >
          {m.name}
          {m.outside ? ` · ${t("community.draft.mentionOutside")}` : ""}
          <button
            type="button"
            aria-label={t("community.draft.mentionRemove", { name: m.name })}
            onClick={() => onChange(mentions.filter((x) => x.userId !== m.userId))}
          >
            <IconX size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
