// V2-M · HD-07: nút "Xoá hợp đồng" (chỉ vai quản lý) ⇒ hộp xác nhận liệt kê tác động (xem trước) ⇒ xoá hẳn, về danh sách.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useDeleteContract } from "../hooks/use-delete-contract";
import { blockedReason, impactLines } from "../lib/impact";

export function DeleteContractButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { impact: q, del } = useDeleteContract(id, open, () => setOpen(false));
  const blocked = q.data ? blockedReason(q.data) : null;
  return (
    <>
      <button
        type="button"
        className="btn btn-outline"
        data-testid="delete-contract"
        onClick={() => setOpen(true)}
      >
        {t("contracts.del.button")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("contracts.del.title")}</DialogTitle>
            <DialogDescription>{t("contracts.del.warn")}</DialogDescription>
          </DialogHeader>
          {q.isPending && <p className="text-dim">{t("contracts.del.loading")}</p>}
          {q.isError && <p role="alert">{t("contracts.del.failed")}</p>}
          {q.data && (
            <ul className="list-disc pl-5 text-sm" data-testid="delete-impact">
              {impactLines(q.data).map((l) => (
                <li key={`${l.key}-${Object.values(l.vars).join("|")}`}>
                  {t(`contracts.del.${l.key}`, {
                    ...l.vars,
                    dir: l.vars.dirKey ? t(`contracts.del.${l.vars.dirKey}`) : undefined,
                  })}
                </li>
              ))}
              <li>{t("contracts.del.keep")}</li>
            </ul>
          )}
          {blocked && (
            <p role="alert" className="text-sm" data-testid="delete-blocked">
              {t("contracts.del.blocked", { reason: blocked })}
            </p>
          )}
          <DialogFooter>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
              {t("contracts.del.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="delete-confirm"
              disabled={!q.data || blocked !== null || del.isPending}
              onClick={() => del.mutate()}
            >
              {del.isPending ? t("contracts.del.deleting") : t("contracts.del.confirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
