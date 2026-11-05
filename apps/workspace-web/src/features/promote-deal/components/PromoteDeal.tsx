// CR-101 DOC-ui-frame · R10: nút "Nâng thành hợp đồng" của giao dịch + hộp chọn file ký và số HĐ (bắt buộc); sau khi nâng HĐ bị khoá.
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
import { docErrorText } from "~/features/frame-panel/lib/frame-view";
import { promoteDeal } from "../api";

function PromoteDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const L = (k: string) => t(`contracts.docframe.promote.${k}`);
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await promoteDeal(id, file as File, number.trim());
      toast(L("done"));
      onClose();
      await qc.invalidateQueries({ queryKey: contractKey(id) });
      await qc.invalidateQueries({ queryKey: ["contracts", "list"] });
    } catch (e) {
      setErr(docErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={L("title")}>
        <DialogHeader>
          <DialogTitle>{L("title")}</DialogTitle>
          <DialogDescription>{L("hint")}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-[13px]" htmlFor="promote-file">
          {L("file")}
          <input
            id="promote-file"
            type="file"
            data-testid="promote-file"
            accept=".pdf,.docx,.jpg,.jpeg,.png,.md"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px]" htmlFor="promote-number">
          {L("number")}
          <input
            id="promote-number"
            className="field"
            value={number}
            maxLength={200}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        {err && (
          <p role="alert" className="text-sm text-late" data-testid="promote-error">
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
            data-testid="promote-submit"
            disabled={busy || !file || number.trim() === ""}
            onClick={() => void submit()}
          >
            {L("submit")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PromoteDeal({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        data-testid="promote-open"
        onClick={() => setOpen(true)}
      >
        {t("contracts.docframe.promote.button")}
      </button>
      {open && <PromoteDialog id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
