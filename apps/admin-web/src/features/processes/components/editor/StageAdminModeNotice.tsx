// CR-103 · fnr-fix-unfreeze: cảnh báo ngắn trên giai đoạn khi Hub ở chế độ route chỉ quản trị (`domain/admin-mode.rules`).
import { useTranslation } from "react-i18next";
import { adminModeWarnings } from "../../domain/admin-mode.rules";
import { useProcessAdminOnly } from "../../engine";

export function StageAdminModeNotice(p: { after: string; gate: boolean; asks: boolean }) {
  const { t } = useTranslation();
  const warnings = adminModeWarnings(useProcessAdminOnly(), p);
  if (warnings.length === 0) return null;
  return (
    <div role="note" className="space-y-1 rounded-md bg-warning-bg px-3 py-2 text-warning">
      {warnings.map((w) => (
        <p key={w} className="text-caption">
          {t(
            w === "review"
              ? "process.admin.editor.stage.adminModeReview"
              : "process.admin.editor.stage.adminModeAsk",
          )}
        </p>
      ))}
    </div>
  );
}
