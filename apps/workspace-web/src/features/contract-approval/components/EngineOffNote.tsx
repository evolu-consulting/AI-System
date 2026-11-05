// engine-off-note · lượt duyệt chạy máy cũ trong khi công ty đã được gán quy trình riêng nhưng chưa bật "Duyệt theo quy trình" (feature
// `contracts-approval-engine`) ⇒ nói rõ vì sao quy trình đã gán không chạy (Luật GỐC #3: màn hình nêu trạng thái + lý do). Nguồn duy nhất:
// cờ `engine_off` của `GET /contracts/:id/approval` (hub tính; không suy ra ở UI).
import { useTranslation } from "react-i18next";

export function EngineOffNote({ off }: { off: boolean }) {
  const { t } = useTranslation();
  if (!off) return null;
  return (
    <p data-approval="engine-off" role="status" className="mb-3 text-sm text-late">
      {t("contracts.approval.engineOff")}
    </p>
  );
}
