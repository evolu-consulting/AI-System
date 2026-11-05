// CR-097 K3a · HD-FR-100 · HD-FR-104 (BA 8.1/8.2): banner trạng thái của HĐ — "Đã xác nhận — đã khoá" (nút tải bản cập nhật chờ K3b,
// owner có link mở lại có lý do) hoặc "Chưa xác nhận" (Chờ duyệt). Chỉ trình bày + hộp thoại mở lại.
import { ApiError } from "@ai/web-kit/http";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { contractKey } from "~/features/contract-review/api";
import { UploadVersionPanel } from "~/features/contract-versions/components/UploadVersionPanel";
import { reopenContract } from "../api";
import { type LockView, lockErrorKey } from "../lib/lock-view";

const MAX = 500;

function ReopenDialog({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await reopenContract(id, reason.trim());
      toast(t("contracts.lock.reopened"));
      onClose();
      setReason("");
      await qc.invalidateQueries({ queryKey: contractKey(id) });
      await qc.invalidateQueries({ queryKey: ["contracts", "list"] });
    } catch (e) {
      const k = e instanceof ApiError ? lockErrorKey(e.status, e.code) : null;
      setErr(t(k ?? "contracts.errors.unknown"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("contracts.lock.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("contracts.lock.dialogHint")}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-[13px]" htmlFor="reopen-reason">
          {t("contracts.lock.reasonLabel")}
          <textarea
            id="reopen-reason"
            className="field min-h-[88px]"
            maxLength={MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {err && (
          <p role="alert" className="text-sm text-late">
            {err}
          </p>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t("contracts.common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="reopen-confirm"
            disabled={busy || reason.trim() === ""}
            onClick={() => void submit()}
          >
            {busy ? t("contracts.lock.reopening") : t("contracts.lock.reopenConfirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Nhãn 🔒 / "Chưa có văn bản" + banner trạng thái. */
export function LockBanner({
  id,
  view,
  canUpdate = false,
}: {
  id: string;
  view: LockView;
  /** K3b: bật nút "Tải bản cập nhật" (đã khoá, chưa bị thay, chưa có nháp, có quyền ghi). */
  canUpdate?: boolean;
}) {
  return (
    <>
      {(view.locked || view.noDocument) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {view.locked && <LockBadge />}
          {view.noDocument && <NoDocumentTag />}
        </div>
      )}
      <BannerBox id={id} view={view} canUpdate={canUpdate} />
    </>
  );
}

function BannerBox({ id, view, canUpdate }: { id: string; view: LockView; canUpdate: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [upOpen, setUpOpen] = useState(false);
  if (view.banner === null) return null;
  if (view.banner === "pending")
    return (
      <div
        data-testid="banner-pending"
        className="mb-3 rounded-xl border border-soon-line bg-soon-bg px-4 py-3 text-sm text-soon"
      >
        <b>{t("contracts.lock.pendingTitle")}</b> — {t("contracts.lock.pendingBody")}
      </div>
    );
  return (
    <div
      data-testid="banner-locked"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-rule bg-sunk px-4 py-3 text-sm"
    >
      <span className="min-w-0 flex-1">
        <b>{t("contracts.lock.bannerTitle")}</b> — {t("contracts.lock.bannerBody")}
      </span>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        data-testid="update-version"
        disabled={!canUpdate}
        onClick={() => setUpOpen(true)}
      >
        {t("contracts.lock.updateVersion")}
      </button>
      {view.canReopen && (
        <button
          type="button"
          className="text-[12.5px] font-medium text-act hover:underline"
          data-testid="reopen-link"
          onClick={() => setOpen(true)}
        >
          {t("contracts.lock.reopenLink")}
        </button>
      )}
      <ReopenDialog id={id} open={open} onClose={() => setOpen(false)} />
      <UploadVersionPanel contractId={id} open={upOpen} onClose={() => setUpOpen(false)} />
    </div>
  );
}

/** Nhãn 🔒 "Đã khoá" cạnh tiêu đề / trong hàng danh sách. */
export function LockBadge() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="lock-badge"
      title={t("contracts.lock.badge")}
      className="inline-flex items-center gap-1 rounded-full border border-rule bg-sunk px-2 py-0.5 text-[12px] font-medium text-dim"
    >
      <span aria-hidden="true">🔒</span>
      {t("contracts.lock.badge")}
    </span>
  );
}

export function NoDocumentTag() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="no-document"
      className="inline-flex rounded-full border border-soon-line bg-soon-bg px-2 py-0.5 text-[12px] text-soon"
    >
      {t("contracts.lock.noDocument")}
    </span>
  );
}
