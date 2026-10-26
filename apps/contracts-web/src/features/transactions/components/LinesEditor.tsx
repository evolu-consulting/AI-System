// CR-097 G2 · GD-FR-01: bảng dòng hàng của giao dịch — SP chọn từ danh mục (tuỳ chọn; thiếu ⇒ dòng không SP, không đụng kho),
// thành phần khi SP có nhiều thành phần, tên, ĐVT, SL, đơn giá, thành tiền tạm tính. Dùng cho form nháp và hộp điều chỉnh.
import type { ProductOut } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { cn } from "~/lib/utils";
import { type FormError, type LineForm, lineAmount, newLine } from "../lib/transactions";

type Props = {
  lines: readonly LineForm[];
  products: readonly ProductOut[];
  onChange: (lines: LineForm[]) => void;
  error?: FormError | null;
  disabled?: boolean;
};
type Field = "name" | "qty" | "price";
type Patch = (p: Partial<LineForm>) => void;
type RowProps = {
  l: LineForm;
  i: number;
  disabled?: boolean;
  onPatch: Patch;
};

const bad = (e: FormError | null | undefined, i: number, f: Field) =>
  typeof e === "object" && e !== null && e.line === i && e.field === f;

function LineHead({
  l,
  i,
  disabled,
  onPatch,
  products,
  onPick,
  onRemove,
}: RowProps & {
  products: readonly ProductOut[];
  onPick: (id: string) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.txn.${k}`, o);
  const prod = products.find((x) => x.id === l.product_id);
  const n = i + 1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-6 text-[12.5px] text-dim">{n}.</span>
      <select
        aria-label={L("line.productAria", { n })}
        value={l.product_id}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value)}
        className="field h-[2.1rem] w-auto max-w-[280px] min-w-[200px]"
      >
        <option value="">{L("line.noProduct")}</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {prod && prod.components.length > 1 && (
        <select
          aria-label={L("line.componentAria", { n })}
          value={l.component_id}
          disabled={disabled}
          onChange={(e) => onPatch({ component_id: e.target.value })}
          className="field h-[2.1rem] w-auto max-w-[240px] min-w-[160px]"
        >
          {prod.components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {onRemove && !disabled && (
        <button
          type="button"
          className="btn btn-sm ml-auto"
          aria-label={L("line.removeAria", { n })}
          onClick={onRemove}
        >
          {L("line.remove")}
        </button>
      )}
    </div>
  );
}

function LineFields({ l, i, disabled, onPatch, error }: RowProps & { error?: FormError | null }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.txn.${k}`, o);
  const n = i + 1;
  const input = (f: Field | "unit", cls: string, extra: object = {}) => (
    <input
      aria-label={L(`line.${f}Aria`, { n })}
      placeholder={L(f === "name" ? "line.namePh" : `line.${f}`)}
      value={l[f]}
      disabled={disabled}
      onChange={(e) => onPatch({ [f]: e.target.value })}
      className={cn("field h-[2.1rem]", cls, f !== "unit" && bad(error, i, f) && "border-late")}
      {...extra}
    />
  );
  return (
    <div className="flex flex-wrap items-center gap-2 pl-8">
      {input("name", "min-w-[220px] flex-1", { maxLength: 300 })}
      {input("unit", "w-[90px]", { maxLength: 40 })}
      {input("qty", "w-[100px] text-right", { inputMode: "decimal" })}
      {input("price", "w-[140px] text-right", { inputMode: "numeric" })}
      <span
        className="w-[130px] text-right text-[13px] tabular-nums"
        data-testid={`tx-amount-${i}`}
      >
        {vnd(lineAmount(l.qty, l.price))}
      </span>
    </div>
  );
}

export function LinesEditor({ lines, products, onChange, error, disabled }: Props) {
  const { t } = useTranslation();
  const patch = (i: number, p: Partial<LineForm>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const pick = (i: number, id: string) => {
    const prod = products.find((x) => x.id === id);
    const cur = lines[i];
    if (!cur) return;
    patch(i, {
      product_id: id,
      component_id: prod && prod.components.length > 1 ? (prod.components[0]?.id ?? "") : "",
      name: cur.name.trim() ? cur.name : (prod?.name ?? ""),
      unit: cur.unit.trim() ? cur.unit : (prod?.unit ?? ""),
    });
  };
  return (
    <div className="flex flex-col gap-3" data-testid="tx-lines">
      {lines.map((l, i) => (
        <div
          key={l.key}
          data-testid={`tx-line-${i}`}
          className="flex flex-col gap-2 rounded-lg border border-rule bg-panel p-3"
        >
          <LineHead
            l={l}
            i={i}
            disabled={disabled}
            products={products}
            onPatch={(p) => patch(i, p)}
            onPick={(id) => pick(i, id)}
            onRemove={
              lines.length > 1 ? () => onChange(lines.filter((_, j) => j !== i)) : undefined
            }
          />
          <LineFields l={l} i={i} disabled={disabled} error={error} onPatch={(p) => patch(i, p)} />
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className="btn btn-sm self-start"
          onClick={() => onChange([...lines, newLine()])}
        >
          {t("contracts.txn.line.add")}
        </button>
      )}
    </div>
  );
}
