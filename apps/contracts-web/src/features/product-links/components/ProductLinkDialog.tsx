// products-confirm · BA 5.5: hộp "Gắn sản phẩm" lúc xác nhận HĐ — liệt kê dòng HĐ; mỗi dòng "dùng SP có sẵn" (SP trùng tên, tốt nhất
// chọn sẵn) hoặc "tạo SP mới" (mặc định khi không có SP trùng). Xác nhận ⇒ `onConfirm(links)`; SP chỉ được tạo/gắn sau bước này.
import type { ContractDeal, ContractItem, ProductLink, ProductOut } from "@ai/contracts";
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
import { incomplete, initialChoices, type LinkChoice, toLinks } from "../lib/links";

export type ProductLinkTarget = {
  items: ContractItem[];
  products: ProductOut[];
  deal: ContractDeal | null;
};

export function ProductLinkDialog(o: {
  target: ProductLinkTarget | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (links: ProductLink[]) => void;
}) {
  const { t } = useTranslation();
  const [cs, setCs] = useState<LinkChoice[]>([]);
  useEffect(() => {
    if (o.target) setCs(initialChoices(o.target.items, o.target.products, o.target.deal));
  }, [o.target]);
  const patch = (i: number, p: Partial<LinkChoice>) =>
    setCs((s) => s.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <Dialog open={o.target !== null} onOpenChange={(v) => !v && o.onCancel()}>
      <DialogContent data-testid="product-link-dialog">
        <DialogHeader>
          <DialogTitle>{t("contracts.plink.title")}</DialogTitle>
          <DialogDescription>{t("contracts.plink.desc")}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] space-y-3 overflow-y-auto text-[14px]">
          {cs.map((c, i) => (
            <ChoiceRow key={c.item_id} c={c} i={i} patch={patch} />
          ))}
        </ul>
        <DialogFooter>
          <button type="button" className="btn btn-quiet" onClick={o.onCancel}>
            {t("contracts.plink.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="product-link-confirm"
            disabled={o.busy || incomplete(cs)}
            onClick={() => o.onConfirm(toLinks(cs))}
          >
            {t("contracts.plink.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceRow({
  c,
  i,
  patch,
}: {
  c: LinkChoice;
  i: number;
  patch: (i: number, p: Partial<LinkChoice>) => void;
}) {
  const { t } = useTranslation();
  const name = `plink-${c.item_id}`;
  return (
    <li className="rounded-lg border border-rule p-3" data-testid={`plink-row-${i}`}>
      <div className="mb-2 font-medium">{c.item_name}</div>
      <label className="mr-4 inline-flex items-center gap-1.5">
        <input
          type="radio"
          name={name}
          checked={c.mode === "existing"}
          disabled={c.candidates.length === 0}
          onChange={() => patch(i, { mode: "existing", product_id: c.candidates[0]?.id ?? "" })}
        />
        {t("contracts.plink.useExisting")}
      </label>
      <label className="inline-flex items-center gap-1.5">
        <input
          type="radio"
          name={name}
          checked={c.mode === "new"}
          onChange={() => patch(i, { mode: "new" })}
        />
        {t("contracts.plink.createNew")}
      </label>
      {c.mode === "existing" ? (
        <select
          aria-label={t("contracts.plink.pickAria", { name: c.item_name })}
          className="field mt-2 h-[2.1rem] w-full"
          value={c.product_id}
          onChange={(e) => patch(i, { product_id: e.target.value })}
        >
          {c.candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label={t("contracts.plink.newNameAria", { name: c.item_name })}
            className="field h-[2.1rem] min-w-[220px] flex-1"
            value={c.new_name}
            maxLength={300}
            onChange={(e) => patch(i, { new_name: e.target.value })}
          />
          <select
            aria-label={t("contracts.plink.groupAria")}
            className="field h-[2.1rem] w-auto"
            value={c.new_group}
            onChange={(e) => patch(i, { new_group: e.target.value as LinkChoice["new_group"] })}
          >
            {(["goods", "service", "referral"] as const).map((g) => (
              <option key={g} value={g}>
                {t(`contracts.catalog.group.${g}`)}
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  );
}
