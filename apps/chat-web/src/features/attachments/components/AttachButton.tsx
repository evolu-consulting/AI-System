// HUB-FR-44 · CR-173 · nút kẹp giấy chọn tệp (`accept` từ `ATTACH_ALLOWED`): bộ chọn tệp chung của web-kit, bản gọn cho ô soạn.
// Luật loại/cỡ/số lượng do hàng đợi `useAttachments` kiểm và báo (`check={false}`): ở đây chỉ chọn.
import { ATTACH_ALLOWED } from "@ai/contracts/chat";
import { attachPickLabels } from "@ai/web-kit/attach-layout";
import { AttachPickButton } from "@ai/web-kit/ui/AttachDropzone";
import { useTranslation } from "react-i18next";

const ACCEPT = Object.keys(ATTACH_ALLOWED)
  .map((ext) => `.${ext}`)
  .join(",");

export function AttachButton({ onPick }: { onPick(files: File[]): void }) {
  const { t } = useTranslation();
  return (
    <AttachPickButton
      labels={attachPickLabels(t, "attach.pick")}
      accept={ACCEPT}
      check={false}
      onFiles={onPick}
    />
  );
}
