// CR-182 · «Từ chối ký»: hộp nhập lý do (bắt buộc). Người khác thấy được ⇒ Dialog ngắn, nút ghi đúng hành động (RULES.md · Xác nhận).
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai/web-kit/ui/kit/dialog";
import { Field } from "@ai/web-kit/ui/kit/field";
import { Textarea } from "@ai/web-kit/ui/kit/textarea";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function DeclineDialog(p: {
  open: boolean;
  company: string;
  busy: boolean;
  onOk: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => {
    const r = reason.trim();
    if (!r) return setErr(true);
    p.onOk(r);
  };
  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent data-testid="partner-decline" closeLabel={t("contracts.docsign.close")}>
        <DialogHeader>
          <DialogTitle>{t("contracts.psign.decl.title")}</DialogTitle>
          <DialogDescription>
            {t("contracts.psign.decl.desc", { company: p.company })}
          </DialogDescription>
        </DialogHeader>
        <Field
          id="decline-reason"
          label={t("contracts.psign.decl.reason")}
          error={err ? t("contracts.psign.decl.required") : undefined}
        >
          <Textarea
            value={reason}
            maxLength={2000}
            rows={4}
            placeholder={t("contracts.psign.decl.ph")}
            onChange={(e) => {
              setReason(e.target.value);
              setErr(false);
            }}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={p.onClose}>
            {t("contracts.psign.decl.back")}
          </Button>
          <Button variant="danger" busy={p.busy} onClick={submit}>
            {t("contracts.psign.decl.ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
