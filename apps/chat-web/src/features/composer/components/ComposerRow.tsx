// CHAT-AC-05, X2a-AC · hàng nhập của Composer: [đính kèm] textarea [Gửi|Dừng]. `attach = null` ⇒ không nút đính kèm và thả tệp chỉ bị chặn mặc định (không upload).
import type { TFunction } from "i18next";
import { ArrowUp, Square } from "lucide-react";
import type { KeyboardEventHandler, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { AttachButton } from "~/features/attachments/components/AttachButton";
import type { useAttachments } from "~/features/attachments/hooks/use-attachments";

/** Tooltip nút Gửi khi bị khoá. */
export function sendTitle(t: TFunction, locked: boolean, uploading: boolean): string | undefined {
  if (locked) return t("composer.busy");
  return uploading ? t("attach.waitUpload") : undefined;
}

export type RowAttach = {
  add(files: File[]): void;
  dropProps: ReturnType<typeof useAttachments>["dropProps"];
};

type Props = {
  areaRef: RefObject<HTMLTextAreaElement>;
  text: string;
  labels: { input: string; placeholder: string };
  aria: { expanded?: boolean; controls?: string; activeDescendant?: string; describedBy?: string };
  flow: boolean;
  running: boolean;
  enabled: boolean;
  sendTitle: string | undefined;
  attach: RowAttach | null;
  onChange(value: string, caret: number): void;
  onCaret(caret: number): void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSend(): void;
  onStop?(): void;
};

export function ComposerRow(p: Props) {
  const { t } = useTranslation();
  return (
    <div
      {...rowDropProps(p.attach)}
      className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
    >
      {p.attach && <AttachButton onPick={p.attach.add} />}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: plan-frontend §1.1 cần aria-expanded; giữ role textbox vì e2e chọn textbox "Tin nhắn". */}
      <textarea
        ref={p.areaRef}
        rows={1}
        value={p.text}
        aria-label={p.labels.input}
        placeholder={p.labels.placeholder}
        aria-expanded={p.aria.expanded}
        aria-controls={p.aria.controls}
        aria-activedescendant={p.aria.activeDescendant}
        aria-describedby={p.aria.describedBy}
        onChange={(e) => p.onChange(e.target.value, e.target.selectionStart)}
        onSelect={(e) => p.onCaret(e.currentTarget.selectionStart)}
        onKeyDown={p.onKeyDown}
        className="max-h-none min-h-6 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-placeholder"
      />
      {p.running ? (
        <Button type="button" size="icon" aria-label={t("composer.stop")} onClick={p.onStop}>
          <Square className="size-4 fill-current" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          aria-label={t(p.flow ? "composer.sendInFlow" : "composer.send")}
          title={p.sendTitle}
          disabled={!p.enabled}
          onClick={p.onSend}
        >
          <ArrowUp className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

const swallow = (e: { preventDefault(): void }) => e.preventDefault();

/** Tắt đính kèm (phòng không upload): vẫn chặn mặc định để trình duyệt không mở tệp và rời SPA, nhưng không thêm tệp. */
export function rowDropProps(attach: RowAttach | null): RowAttach["dropProps"] {
  return attach ? attach.dropProps : { onDragOver: swallow, onDrop: swallow };
}
