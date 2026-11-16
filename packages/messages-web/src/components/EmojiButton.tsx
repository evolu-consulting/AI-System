// CR-178 · M2 · nút emoji ở ô soạn: mở bảng chọn trong Popover; bảng nạp lười ở lần bấm đầu.
import { Popover, PopoverContent, PopoverTrigger } from "@ai/web-kit/ui/kit/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconSmile } from "../icons";

const EmojiPickerPanel = lazy(() => import("./EmojiPickerPanel"));

export function EmojiButton({
  onPick,
  onClosed,
}: {
  onPick: (emoji: string) => void;
  /** Đóng bảng ⇒ trả focus về ô soạn. */
  onClosed: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t("contracts.messages.emoji.open");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              data-testid="composer-emoji"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-dim hover:bg-sunk hover:text-ink"
            >
              <IconSmile width={19} height={19} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        side="top"
        className="w-[19rem] overflow-hidden p-0"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
      >
        <Suspense
          fallback={
            <p className="m-0 grid h-80 place-items-center text-label text-dim">
              {t("contracts.messages.emoji.loading")}
            </p>
          }
        >
          <EmojiPickerPanel
            onPick={(e) => {
              onPick(e);
              setOpen(false);
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
