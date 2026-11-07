// ADM-FR-66 · CR-056 · P-a F5: thanh lưu dính đáy của editor quy trình ("Chưa lưu thay đổi" · Huỷ · Lưu).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ApplyStatus } from "../../hooks/use-apply-flow";
import { saveModeOf } from "../../lib/company-copy";
import { useLibraryCanvas } from "../library/library-canvas-ctx";
import { ApplyStatusLine } from "./ApplyStatusLine";

/** `version` (đã lưu) hiện thành chữ trạng thái thay cho toast — toast ở góc dưới phải sẽ che nút Lưu. */
type Props = {
  dirty: boolean;
  pending: boolean;
  formId: string;
  version?: number;
  /** CR-121 c17b · bản RIÊNG của công ty (sửa thẳng, không Xuất bản): nói rõ lưu là áp dụng ngay cho lượt mới. */
  companyCopy?: boolean;
  /** CR-123 FR-10 · trạng thái bước áp dụng của bản công ty (đã áp dụng / lỗi nghiệp vụ). */
  apply?: { status: ApplyStatus; needsApply: boolean };
};

export function ProcessSaveBar({ dirty, pending, formId, version, companyCopy, apply }: Props) {
  const { t } = useTranslation();
  const lib = useLibraryCanvas() !== null; // CR-105 UX: quy trình khe ⇒ "Lưu nháp" (khác "Xuất bản")
  const mode = saveModeOf(!!companyCopy, lib); // CR-123 FR-10: bản của công ty ⇒ một nút "Lưu và áp dụng"
  const busy = pending || apply?.status.kind === "pending";
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="min-w-0 flex-1 text-label text-muted-foreground">
        {apply && companyCopy ? (
          // CR-123 u9: bản công ty = MỘT dòng trạng thái (không "Đã lưu · vN" + ghi chú + xác nhận chồng nhau)
          <ApplyStatusLine status={apply.status} needsApply={apply.needsApply} dirty={dirty} />
        ) : (
          <>
            {dirty
              ? t("common.unsaved")
              : version === undefined
                ? null
                : t("common.savedVersion", { n: version })}
            {mode.noteKey ? (
              <span className="block" data-testid="copy-save-note">
                {t(mode.noteKey)}
              </span>
            ) : null}
          </>
        )}
      </div>
      <Button variant="outline" asChild>
        <Link to="/processes">{t("common.cancel")}</Link>
      </Button>
      <Button type="submit" form={formId} disabled={busy} aria-disabled={busy}>
        {t(mode.labelKey)}
      </Button>
    </div>
  );
}
