// CR-127 · M4 · «Khi gửi, hợp đồng sẽ đi qua: 1. Duyệt · Phòng Pháp chế · 48 giờ → 2. …» cạnh nút Gửi duyệt của HĐ nháp.
// Khoá theo `version` ⇒ tự tải lại sau mỗi lần lưu (giá trị/trường đổi ⇒ luật rẽ nhánh đổi). `block='no_flow'` ⇒ không hiện khối
// (dòng lý do NF1 ở trang đã nói, không lặp hai câu). Lỗi ⇒ một dòng nhẹ, không chặn việc gửi.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchSubmitPreview, submitPreviewKey } from "../api";
import { previewLines } from "../lib/submit-preview";

export function SubmitPreview({ id, version }: { id: string; version: number }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: submitPreviewKey(id, version),
    queryFn: ({ signal }) => fetchSubmitPreview(id, signal),
    retry: false,
  });
  if (q.isError)
    return (
      <p className="mb-3 text-caption text-dim" data-testid="submit-preview-error">
        {t("contracts.u5.preview.loadError")}
      </p>
    );
  const lines = previewLines(q.data, (n) => t("contracts.u5.preview.hours", { n }));
  if (lines.length === 0) return null;
  return (
    <div data-testid="submit-preview" className="mb-3 text-sm">
      <p className="m-0 font-medium">{t("contracts.u5.preview.title")}</p>
      <ol className="m-0 mt-1 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-dim">
        {lines.map((l, i) => (
          <li key={l.n} data-testid="submit-preview-step">
            {i > 0 && <span aria-hidden="true">→ </span>}
            {l.n}. {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
