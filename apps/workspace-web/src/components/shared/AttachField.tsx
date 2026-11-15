// CR-173 · MỘT ô «đính tệp» của Sổ Hợp Tác: vùng kéo-thả + thẻ tệp đã chọn (bộ chung `@ai/web-kit`, mở rộng CR-164).
// Màn chỉ giữ trạng thái (tệp/ id đã chọn, đang tải, lỗi) và gọi tải lên; không tự vẽ ô chọn tệp.
import { ATTACH_ALLOWED, ATTACH_MAX_BYTES } from "@ai/contracts/chat";
import { attachLabels } from "@ai/messages-web/lib/attach-view";
import { attachPickLabels } from "@ai/web-kit/attach-layout";
import { AttachDraftList, type DraftItem } from "@ai/web-kit/ui/AttachDraft";
import { AttachDropzone } from "@ai/web-kit/ui/AttachDropzone";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** Loại + cỡ tối đa của `POST /attachments` (ô bằng chứng, form quy trình, phiếu yêu cầu). */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACH_ALLOWED)
  .map((ext) => `.${ext}`)
  .join(",");
export { ATTACH_MAX_BYTES as ATTACHMENT_MAX_BYTES };

/** Tệp đang chọn (chưa tải lên) ⇒ mục thẻ. */
export const fileToDraft = (f: File, status: DraftItem["status"] = "ready"): DraftItem => ({
  id: `${f.name}:${f.size}:${f.lastModified}`,
  name: f.name,
  mime: f.type,
  size: f.size,
  file: f,
  status,
});

/** Nhãn ô chọn tệp theo ngôn ngữ hiện tại (cho màn dùng thẳng `AttachDropzone`). */
export function useAttachPickLabels() {
  const { t } = useTranslation();
  return useMemo(() => attachPickLabels(t, "contracts.attachPick"), [t]);
}

export type AttachFieldProps = {
  items: readonly DraftItem[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  accept?: string;
  maxBytes?: number;
  maxFiles?: number;
  /** false ⇒ MỘT tệp, chọn lại thì thay (ô `file_ref`, bản đã ký…). */
  multiple?: boolean;
  busy?: boolean;
  disabled?: boolean;
  error?: string | undefined;
  hint?: string;
  inputId?: string;
  inputTestId?: string;
  ariaLabel?: string;
  /** Giữ testid cũ của màn (danh sách / từng thẻ). */
  listTestId?: string;
  itemTestId?: string;
};

export function AttachField(p: AttachFieldProps) {
  const { t, i18n } = useTranslation();
  const picks = useMemo(() => attachPickLabels(t, "contracts.attachPick"), [t]);
  const labels = useMemo(() => attachLabels(t), [t]);
  const single = p.multiple === false;
  return (
    <div data-testid="attach-field" className="flex min-w-0 flex-col gap-2">
      <AttachDropzone
        labels={picks}
        variant={single && p.items.length > 0 ? "compact" : "full"}
        accept={p.accept ?? ATTACHMENT_ACCEPT}
        maxBytes={p.maxBytes ?? ATTACH_MAX_BYTES}
        {...(p.maxFiles !== undefined ? { maxFiles: p.maxFiles } : {})}
        multiple={!single}
        current={p.items.length}
        busy={p.busy}
        disabled={p.disabled}
        error={p.error}
        {...(p.hint ? { hint: p.hint } : {})}
        locale={i18n.language}
        onFiles={p.onFiles}
        {...(p.inputId ? { inputId: p.inputId } : {})}
        {...(p.inputTestId ? { inputTestId: p.inputTestId } : {})}
      />
      <AttachDraftList
        items={p.items}
        labels={labels}
        layout="stack"
        busy={p.busy && p.items.length === 0}
        locale={i18n.language}
        {...(p.ariaLabel ? { ariaLabel: p.ariaLabel } : {})}
        {...(p.listTestId ? { listTestId: p.listTestId } : {})}
        {...(p.itemTestId ? { itemTestId: p.itemTestId } : {})}
        onRemove={p.onRemove}
      />
    </div>
  );
}
