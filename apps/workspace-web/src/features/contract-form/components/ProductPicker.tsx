// V2-F · BA 5.5a/5.5c/5.5f/5.7e · mockup `linkRow`: dưới mỗi dòng HĐ — chọn "Sản phẩm trong danh mục" (hoặc tạo mới), chọn thành phần
// khi SP có nhiều thành phần, nhãn gợi ý, tồn hiện có và cảnh báo "Bán vượt tồn" (chỉ HĐ Bán).
import type { ContractDeal, ProductGroup, ProductOut } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Tag } from "~/components/shared/tag";
import { cn } from "~/lib/utils";
import { type LineState, NEW_PRODUCT } from "../lib/form-model";
import { type StockHint, stockHint } from "../lib/stock";

const GROUPS: readonly ProductGroup[] = ["service", "goods", "referral"];
type Patch = (p: Partial<LineState>) => void;

function NewProductFields({
  line,
  n,
  deal,
  invalid,
  onPatch,
}: {
  line: LineState;
  n: number;
  deal: ContractDeal;
  invalid: boolean;
  onPatch: Patch;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cform.${k}`, o);
  return (
    <>
      <input
        aria-label={L("newNameAria", { n })}
        value={line.new_name}
        onChange={(e) => onPatch({ new_name: e.target.value })}
        placeholder={L("newNamePh")}
        className={cn("field h-[2.1rem] w-[220px]", invalid && "border-late")}
      />
      <select
        aria-label={L("newGroupAria", { n })}
        value={deal === "referral" ? "referral" : line.new_group}
        disabled={deal === "referral"}
        onChange={(e) => onPatch({ new_group: e.target.value as ProductGroup })}
        className="field h-[2.1rem] w-auto min-w-[150px]"
      >
        {GROUPS.map((g) => (
          <option key={g} value={g}>
            {L(`group.${g}`)}
          </option>
        ))}
      </select>
      <Tag tone="soon">{L("newProduct")}</Tag>
    </>
  );
}

function StockText({ stock }: { stock: NonNullable<StockHint> }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cform.${k}`, o);
  return (
    <span
      className={cn("text-[12px]", stock.short ? "text-late" : "text-dim")}
      data-testid={stock.short ? "oversell" : "on-hand"}
    >
      {stock.short ? `⚠ ${L("oversell")}: ` : ""}
      {L("onHand", { n: stock.onHand.toLocaleString("vi-VN"), unit: stock.unit ?? "" })}
    </span>
  );
}

function ComponentSelect({
  product,
  value,
  n,
  onPatch,
}: {
  product: ProductOut;
  value: string;
  n: number;
  onPatch: Patch;
}) {
  const { t } = useTranslation();
  return (
    <select
      aria-label={t("contracts.cform.componentAria", { n })}
      value={value}
      onChange={(e) => onPatch({ component_id: e.target.value })}
      className="field h-[2.1rem] w-auto max-w-[260px] min-w-[200px]"
    >
      {product.components.map((c) => (
        <option key={c.id} value={c.id}>
          {t("contracts.cform.componentOpt", { name: c.name })}
        </option>
      ))}
    </select>
  );
}

export function ProductPicker({
  line,
  index,
  deal,
  products,
  onPatch,
  invalid,
  allowNew = true,
}: {
  line: LineState;
  index: number;
  deal: ContractDeal;
  products: readonly ProductOut[];
  onPatch: Patch;
  invalid: boolean;
  /** Vắng "＋ Tạo sản phẩm mới" khi gắn lại cho HĐ đã lưu (V2-G). */
  allowNew?: boolean;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cform.${k}`, o);
  const options = deal === "referral" ? products.filter((p) => p.group === "referral") : products;
  const isNew = line.product_id === NEW_PRODUCT;
  const picked = products.find((p) => p.id === line.product_id);
  const stock = stockHint(picked, line.component_id, line.qty, deal);
  const n = index + 1;
  const pick = (id: string) => {
    const p = products.find((x) => x.id === id);
    onPatch({
      product_id: id,
      component_id: p && p.components.length > 1 ? (p.components[0]?.id ?? "") : "",
      suggested: false,
      ...(id === NEW_PRODUCT ? { new_name: line.new_name || line.name } : {}),
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pl-0.5" data-testid={`link-${index}`}>
      <span className="text-[12.5px] whitespace-nowrap text-ink-2">{L("linkLabel")}</span>
      <select
        aria-label={L("linkAria", { n })}
        value={line.product_id}
        onChange={(e) => pick(e.target.value)}
        className={cn(
          "field h-[2.1rem] w-auto max-w-[280px] min-w-[220px]",
          invalid && "border-late",
        )}
      >
        <option value="">{L("linkPick")}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {allowNew && <option value={NEW_PRODUCT}>{L("linkNew")}</option>}
      </select>
      {picked && picked.components.length > 1 && (
        <ComponentSelect product={picked} value={line.component_id} n={n} onPatch={onPatch} />
      )}
      {line.suggested && <Tag tone="act">{L("suggested")}</Tag>}
      {isNew && (
        <NewProductFields line={line} n={n} deal={deal} invalid={invalid} onPatch={onPatch} />
      )}
      {invalid && <span className="text-[12px] text-late">{L("unlinked")}</span>}
      {stock && <StockText stock={stock} />}
    </div>
  );
}
