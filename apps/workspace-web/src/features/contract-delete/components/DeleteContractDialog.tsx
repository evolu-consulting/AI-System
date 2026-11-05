// V2-M · HD-07: hộp xoá hợp đồng (xem trước tác động + SP mồ côi + xác nhận). Gắn khi mở (mount = mở); dùng ở trang chi tiết
// (`goList` ⇒ về danh sách sau xoá) và ở danh sách (ở lại, danh sách được làm mới).
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
import { blockedReason, impactLines, pickedProducts } from "../lib/impact";

export function DeleteContractDialog(p: { id: string; onClose: () => void; goList?: boolean }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const { impact: q, del } = useDeleteContract(p.id, true, p.onClose, p.goList ?? true);
  const blocked = q.data ? blockedReason(q.data) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
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
        {q.data && q.data.orphan_products.length > 0 && (
          <OrphanProducts
            items={q.data.orphan_products}
            picked={picked}
            onToggle={(id, on) =>
              setPicked((s) => {
                const n = new Set(s);
                if (on) n.add(id);
                else n.delete(id);
                return n;
              })
            }
          />
        )}
        {blocked && (
          <p role="alert" className="text-sm" data-testid="delete-blocked">
            {t("contracts.del.blocked", { reason: blocked })}
          </p>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-quiet" onClick={p.onClose}>
            {t("contracts.del.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="delete-confirm"
            disabled={!q.data || blocked !== null || del.isPending}
            onClick={() => q.data && del.mutate(pickedProducts(q.data, picked))}
          >
            {del.isPending ? t("contracts.del.deleting") : t("contracts.del.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrphanProducts(o: {
  items: { id: string; name: string }[];
  picked: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="rounded-lg border border-rule p-3 text-sm" data-testid="delete-orphans">
      <legend className="px-1 font-medium">{t("contracts.del.orphansAsk")}</legend>
      <p className="mb-2 text-[12.5px] text-dim">{t("contracts.del.orphansHint")}</p>
      <ul className="space-y-1">
        {o.items.map((p) => (
          <li key={p.id}>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={o.picked.has(p.id)}
                onChange={(e) => o.onToggle(p.id, e.target.checked)}
              />
              {p.name}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
