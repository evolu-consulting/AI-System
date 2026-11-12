// ADM-FR-66 · CR-056 · P-a F5: thanh lưu dính đáy của editor quy trình ("Chưa lưu thay đổi" · Huỷ · Lưu).
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ApplyStatus } from "../../hooks/use-apply-flow";
import { saveModeOf } from "../../lib/company-copy";
import { useFlowCtx, useRecordWords } from "../flow/flow-ctx";
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
  /** CR-127 · U2 · số mục còn lỗi: > 0 ⇒ nút tắt + câu lý do (sửa các thẻ «Cần sửa» rồi áp dụng). */
  blockedCount?: number;
  /** CR-127 · U3 · nút «Chạy thử» (chỉ quy trình theo sự kiện + quản trị nền tảng). */
  testRun?: ReactNode;
  /** CR-127 · M2 · quy trình công ty theo sự kiện: nút chính tên «Áp dụng cho công ty». */
  applyLabel?: boolean;
  /** Bước còn lỗi: bấm ⇒ chọn bước đó (mock: «⚠ N lưu ý»). */
  blockedSteps?: { uid: string; name: string }[];
  /** Lý do cụ thể (đã dịch, không trùng) vì sao nút bị tắt — Luật GỐC 3: nói vì sao không lưu được, không chỉ «N mục cần sửa». */
  blockedReasons?: string[];
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 · M2 — thanh lưu nhiều trạng thái, tách ở đợt dọn sau
export function ProcessSaveBar({
  dirty,
  pending,
  formId,
  version,
  companyCopy,
  apply,
  blockedCount = 0,
  testRun,
  applyLabel,
  blockedSteps = [],
  blockedReasons = [],
}: Props) {
  const { t } = useTranslation();
  const words = useRecordWords();
  const lib = useLibraryCanvas() !== null; // CR-105 UX: quy trình khe ⇒ "Lưu nháp" (khác "Xuất bản")
  const mode = saveModeOf(!!companyCopy, lib); // CR-123 FR-10: bản của công ty ⇒ một nút "Lưu và áp dụng"
  const busy = pending || apply?.status.kind === "pending";
  const blocked = blockedCount > 0;
  const flow = useFlowCtx();
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
                {t(mode.noteKey, words)}
              </span>
            ) : null}
          </>
        )}
      </div>
      {testRun}
      <Button variant="outline" asChild>
        <Link to="/processes">{t("common.cancel")}</Link>
      </Button>
      {blocked ? (
        <span role="status" data-testid="save-blocked" className="text-caption text-destructive">
          {blockedSteps.length > 0
            ? t("process.admin.flow.outline.blockedSteps", { n: blockedSteps.length })
            : t("process.admin.flow.outline.blocked", { n: blockedCount })}{" "}
          {blockedSteps.map((b) => (
            <Button
              key={b.uid}
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 pr-2 text-caption"
              data-testid="blocked-step"
              onClick={() => flow?.selectRef?.current?.(b.uid)}
            >
              {b.name}
            </Button>
          ))}
          {blockedReasons.map((r) => (
            <span key={r} className="block" data-testid="blocked-reason">
              {r}
            </span>
          ))}
        </span>
      ) : null}
      <Button
        type="submit"
        form={formId}
        disabled={busy || blocked}
        aria-disabled={busy || blocked}
        data-testid="save-submit"
      >
        {applyLabel ? t("process.admin.editorBar.apply") : t(mode.labelKey)}
      </Button>
    </div>
  );
}
