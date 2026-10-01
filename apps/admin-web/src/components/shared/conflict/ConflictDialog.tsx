// ADM-FR-55 · AC-A07 · M3-R20…R22 · hộp thoại xung đột 409 dùng chung (missing-screens §12.5; plan-frontend D3, §3.1).
// Một AlertDialog: Escape và click nền không đóng; `Xem khác biệt` mở rộng tại chỗ; `Ghi đè` mở ConfirmDialog con.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
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
import { DiffTable } from "./DiffTable";

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
  const [confirm, setConfirm] = useState(false);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const user = p.updatedBy;
  const body = {
    user,
    entity: t(`conflict.entity.${p.entity}`),
    time: formatClock(p.updatedAt),
    n: p.latestVersion,
    mine: p.mineVersion,
  };
  return (
    <>
      <AlertDialog open>
        <AlertDialogContent
          className={expanded ? "sm:max-w-3xl" : undefined}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            reloadRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("conflict.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(user ? "conflict.body.byUser" : "conflict.body.anon", body)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {expanded ? (
            <DiffTable rows={p.rows} more={p.more} latestVersion={p.latestVersion} />
          ) : null}
          <AlertDialogFooter>
            <Button
              variant="outline"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {t("conflict.action.diff")}
            </Button>
            <Button variant="outline" onClick={() => setConfirm(true)}>
              {t("conflict.action.overwrite")}
            </Button>
            <Button ref={reloadRef} onClick={p.onReload}>
              {t("conflict.action.reload")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t(user ? "conflict.overwrite.titleUser" : "conflict.overwrite.titleAnon", { user })}
        description={t("conflict.overwrite.body", {
          n: p.latestVersion,
          next: p.latestVersion + 1,
        })}
        confirmLabel={t("conflict.action.overwrite")}
        onConfirm={p.onOverwrite}
      />
    </>
  );
}
