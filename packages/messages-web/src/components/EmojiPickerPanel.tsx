// CR-178 · M2 · bảng chọn emoji (Frimousse, headless). Nạp lười từ `EmojiButton` ⇒ không vào bundle đầu.
// Dữ liệu emoji đóng gói sẵn (`data/emoji-vi.json`, nạp lười cùng chunk) ⇒ không gọi CDN ngoài.
import { type EmojiData, type EmojiDataResolver, EmojiPicker } from "frimousse";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { loadRecent, loadSkin, pushRecent, saveRecent, saveSkin } from "../lib/composer";

const resolveEmojiData: EmojiDataResolver = async () =>
  (await import("../data/emoji-vi.json")).default as unknown as EmojiData;

export default function EmojiPickerPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  const [recent, setRecent] = useState(() => loadRecent());
  const [skin, setSkin] = useState(() => loadSkin());
  const pick = (emoji: string) => {
    const next = pushRecent(recent, emoji);
    setRecent(next);
    saveRecent(next);
    onPick(emoji);
  };
  return (
    <EmojiPicker.Root
      locale="vi"
      columns={8}
      skinTone={skin}
      resolveEmojiData={resolveEmojiData}
      onEmojiSelect={(e) => pick(e.emoji)}
      data-testid="emoji-picker"
      className="isolate flex h-80 w-full flex-col bg-panel text-ink"
    >
      <div className="flex items-center gap-1 border-b border-rule p-2">
        <EmojiPicker.Search
          placeholder={t("contracts.messages.emoji.search")}
          aria-label={t("contracts.messages.emoji.search")}
          className="h-8 min-w-0 flex-1 rounded-lg border border-rule bg-sunk px-2.5 text-[13px] outline-none placeholder:text-dim focus:border-act-line"
        />
        <EmojiPicker.SkinToneSelector
          aria-label={t("contracts.messages.emoji.skin")}
          onClick={() => {
            const order = [
              "none",
              "light",
              "medium-light",
              "medium",
              "medium-dark",
              "dark",
            ] as const;
            const next = order[(order.indexOf(skin) + 1) % order.length] ?? "none";
            setSkin(next);
            saveSkin(next);
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-sunk"
        />
      </div>
      {recent.length > 0 && (
        <div className="border-b border-rule px-2 py-1.5" data-testid="emoji-recent">
          <p className="m-0 mb-1 text-label font-medium text-dim">
            {t("contracts.messages.emoji.recent")}
          </p>
          <div className="flex flex-wrap gap-0.5">
            {recent.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={e}
                onClick={() => pick(e)}
                className="grid h-8 w-8 place-items-center rounded-lg text-xl hover:bg-sunk"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
      <EmojiPicker.Viewport className="relative min-h-0 flex-1 outline-none">
        <EmojiPicker.Loading className="absolute inset-0 grid place-items-center text-label text-dim">
          {t("contracts.messages.emoji.loading")}
        </EmojiPicker.Loading>
        <EmojiPicker.Empty className="absolute inset-0 grid place-items-center text-label text-dim">
          {t("contracts.messages.emoji.empty")}
        </EmojiPicker.Empty>
        <EmojiPicker.List
          components={{
            CategoryHeader: ({ category, ...p }) => (
              <div {...p} className="bg-panel px-3 py-1.5 text-label font-medium text-dim">
                {category.label}
              </div>
            ),
            Row: ({ children, ...p }) => (
              <div {...p} className="scroll-my-1 px-1.5">
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...p }) => (
              <button
                {...p}
                type="button"
                className="grid size-9 place-items-center rounded-lg text-xl data-[active]:bg-sunk"
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}
