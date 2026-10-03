// ADM-FR-55 · AC-A07 · M3-R20…R22 · hộp thoại xung đột 409 dùng chung (missing-screens §12.5; plan-frontend D3, §3.1).
// M4-R17: user/tenant cũng có `updated_by` (câu `{user}`); bước Ghi đè nhắc "Lịch sử vẫn giữ v{n}." cho mọi entity.
// Một AlertDialog: Escape và click nền không đóng; `Xem khác biệt` mở rộng tại chỗ; `Ghi đè` chuyển sang bước xác nhận
// ngay trong hộp thoại (alertdialog mang tên câu xác nhận). Khi đang gửi lại, hộp quay về bước chọn với nút khoá để
// hộp thoại xung đột còn hiện (không bị aria-hidden bởi hộp thoại thứ hai) tới khi bản ghi thật sự đã lưu.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffTable } from "@/components/shared/diff/DiffTable";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { DiffRow } from "@/lib/diff-fields";
import { formatClock } from "@/lib/format";

export type ConflictEntity = "user" | "tenant" | "workflow" | "command" | "feature" | "group";

export type ConflictDialogProps = {
  entity: ConflictEntity;
  mineVersion: number;
  latestVersion: number;
  updatedAt: string;
  updatedBy: string | null;
  rows: DiffRow[];
  more: number;
  onOverwrite: () => Promise<void>;
  onReload: () => void;
};

export default function ConflictDialog(p: ConflictDialogProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [pending, setPending] = useState(false);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const overwriteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const prevStep = useRef(step);
  const user = p.updatedBy;
  const body = {
    user,
    entity: t(`conflict.entity.${p.entity}`),
    time: formatClock(p.updatedAt),
    n: p.latestVersion,
    mine: p.mineVersion,
  };
  const overwrite = () => {
    setPending(true);
    setStep("choose");
    void p.onOverwrite().finally(() => setPending(false));
  };
  const confirming = step === "confirm";
  // Đổi bước làm nút đang focus bị gỡ → đưa focus sang nút tương ứng (huỷ → "Ghi đè"; vào xác nhận → "Huỷ").
  useEffect(() => {
    if (prevStep.current === step) return; // mount (kể cả StrictMode chạy effect hai lần) → để onOpenAutoFocus quyết
    prevStep.current = step;
    (step === "confirm" ? cancelRef : overwriteRef).current?.focus();
  }, [step]);
  return (
    <AlertDialog open>
      <AlertDialogContent
        className={expanded && !confirming ? "sm:max-w-3xl" : undefined}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          reloadRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirming
              ? t(user ? "conflict.overwrite.titleUser" : "conflict.overwrite.titleAnon", { user })
              : t("conflict.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirming
              ? `${t("conflict.overwrite.body", { n: p.latestVersion, next: p.latestVersion + 1 })} ${t("conflict.overwrite.history", { n: p.latestVersion })}`
              : t(user ? "conflict.body.byUser" : "conflict.body.anon", body)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {expanded && !confirming ? (
          <DiffTable rows={p.rows} more={p.more} latestVersion={p.latestVersion} />
        ) : null}
        {confirming ? (
          <AlertDialogFooter>
            <Button ref={cancelRef} variant="outline" onClick={() => setStep("choose")}>
              {t("common.cancel")}
            </Button>
            <Button onClick={overwrite}>{t("conflict.action.overwrite")}</Button>
          </AlertDialogFooter>
        ) : (
          <AlertDialogFooter>
            <Button
              variant="outline"
              aria-expanded={expanded}
              disabled={pending}
              onClick={() => setExpanded(!expanded)}
            >
              {t("conflict.action.diff")}
            </Button>
            <Button
              ref={overwriteRef}
              variant="outline"
              disabled={pending}
              onClick={() => setStep("confirm")}
            >
              {t("conflict.action.overwrite")}
            </Button>
            <Button ref={reloadRef} disabled={pending} onClick={p.onReload}>
              {t("conflict.action.reload")}
            </Button>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
