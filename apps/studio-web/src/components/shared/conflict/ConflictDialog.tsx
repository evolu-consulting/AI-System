// HUB-FR-69 · H4a-R09 · hộp xung đột 409 dùng chung (Agent editor, Orchestrator — mẫu Admin ConflictDialog, copy `conflict.*`).
// Một AlertDialog: Escape/click nền không đóng; [Xem khác biệt] mở rộng tại chỗ; [Ghi đè] sang bước xác nhận ngay trong hộp;
// khi đang gửi lại, hộp quay về bước chọn với nút khoá (hộp còn hiện tới khi bản ghi thật sự đã lưu).
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { formatClock } from "#/lib/format";
import { DiffTable } from "./DiffTable";
import type { DiffRow } from "./types";

export type ConflictDialogProps = {
  mineVersion: number;
  latestVersion: number;
  updatedAt: string;
  rows: DiffRow[];
  more: number;
  onOverwrite: () => Promise<void>;
  onReload: () => void;
};

export function ConflictDialog(p: ConflictDialogProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const overwrite = () => {
    setPending(true);
    setConfirming(false);
    void p.onOverwrite().finally(() => setPending(false));
  };
  const n = p.latestVersion;
  const body = confirming
    ? `${t("conflict.overwrite.body", { n, next: n + 1 })} ${t("conflict.overwrite.history", { n })}`
    : t("conflict.body.anon", { time: formatClock(p.updatedAt), n, mine: p.mineVersion });
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
            {confirming ? t("conflict.overwrite.titleAnon") : t("conflict.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {expanded && !confirming ? (
          <DiffTable rows={p.rows} more={p.more} latestVersion={n} />
        ) : null}
        {confirming ? (
          <AlertDialogFooter>
            <Button variant="outline" autoFocus onClick={() => setConfirming(false)}>
              {t("editor.cancel")}
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
            <Button variant="outline" disabled={pending} onClick={() => setConfirming(true)}>
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
