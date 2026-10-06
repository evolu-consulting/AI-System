// HUB-FR-44 · nút kẹp giấy + ô chọn tệp ẩn (`accept` từ `ATTACH_ALLOWED`).
import { ATTACH_ALLOWED } from "@ai/contracts/chat";
import { Paperclip } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

const ACCEPT = Object.keys(ATTACH_ALLOWED)
  .map((ext) => `.${ext}`)
  .join(",");

export function AttachButton({ onPick }: { onPick(files: File[]): void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={t("attach.button")}
        onClick={() => input.current?.click()}
      >
        <Paperclip className="size-4" aria-hidden="true" />
      </Button>
    </>
  );
}
