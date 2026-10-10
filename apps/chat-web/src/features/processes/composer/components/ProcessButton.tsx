// CHAT-AC-51 · nút "Quy trình" cạnh nút Gửi: bật/tắt cùng listbox `!` (aria-haspopup/aria-expanded); chọn dòng điền `!key `.
import { Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { PROCESS_MENU_ID } from "~/features/composer/lib/menu-ids";
import { useBangState } from "../lib/bang-state";

export type ProcessButtonProps = {
  /** Điền `text` vào ô nhập (Composer `change`). */
  onInsert(text: string): void;
  disabled?: boolean;
};

export function ProcessButton({ onInsert, disabled }: ProcessButtonProps) {
  const { t } = useTranslation();
  const bang = useBangState();
  const label = t("process.composer.button");
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      aria-haspopup="listbox"
      aria-expanded={bang.open}
      aria-controls={bang.open ? PROCESS_MENU_ID : undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // giữ focus ở ô nhập (như chọn dòng menu)
      onClick={(e) => {
        const area = e.currentTarget.parentElement?.querySelector("textarea");
        bang.toggle(onInsert);
        area?.focus();
      }}
    >
      <Workflow className="size-4" aria-hidden="true" />
    </Button>
  );
}
