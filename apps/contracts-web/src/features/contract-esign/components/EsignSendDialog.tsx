// cf-esign-docusign · hộp "Gửi ký": người ký mặc định (bên mình = user hiện tại, đối tác = liên hệ có email), sửa được, ký tuần tự.
import type { ESignSignerIn } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EsignSendDialog({
  open,
  defaults,
  busy,
  err,
  onClose,
  onSend,
}: {
  open: boolean;
  defaults: ESignSignerIn[];
  busy: boolean;
  err: string | null;
  onClose: () => void;
  onSend: (s: ESignSignerIn[]) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ESignSignerIn[]>(defaults);
  useEffect(() => {
    if (open) setRows(defaults);
  }, [open, defaults]);
  const ok = rows.every((r) => r.name.trim() !== "" && EMAIL.test(r.email.trim()));
  const set = (i: number, k: "name" | "email", v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("contracts.esign.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("contracts.esign.dialogHint")}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li
              key={r.role}
              className="flex flex-col gap-1 text-[13px]"
              data-testid={`esign-signer-${i}`}
            >
              <b>
                {i + 1}.{" "}
                {t(
                  r.role === "company"
                    ? "contracts.esign.roleCompany"
                    : "contracts.esign.rolePartner",
                )}
              </b>
              <div className="flex gap-2 max-sm:flex-col">
                <input
                  className="field flex-1"
                  aria-label={`${t("contracts.esign.name")} ${i + 1}`}
                  value={r.name}
                  maxLength={100}
                  onChange={(e) => set(i, "name", e.target.value)}
                />
                <input
                  className="field flex-1"
                  type="email"
                  aria-label={`${t("contracts.esign.email")} ${i + 1}`}
                  value={r.email}
                  maxLength={200}
                  onChange={(e) => set(i, "email", e.target.value)}
                />
              </div>
            </li>
          ))}
        </ol>
        {err && (
          <p role="alert" className="text-sm text-late">
            {err}
          </p>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t("contracts.esign.close")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="esign-send-confirm"
            disabled={busy || !ok}
            onClick={() =>
              onSend(rows.map((r) => ({ ...r, name: r.name.trim(), email: r.email.trim() })))
            }
          >
            {busy ? t("contracts.esign.sending") : t("contracts.esign.send")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
