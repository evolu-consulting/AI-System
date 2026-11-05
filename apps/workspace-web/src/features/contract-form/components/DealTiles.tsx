// V2-F · HD-01 · mockup `.kindpick`: ba ô chọn loại hợp đồng Mua / Bán / Giới thiệu (radiogroup). `locked` ⇒ không đổi được (HĐ đã lưu, HD-09).
import type { ContractDeal } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { SegButton } from "~/components/shared/seg-button";
import { cn } from "~/lib/utils";
import { DEALS } from "../lib/deal";

const tile = (on: boolean, locked: boolean) =>
  cn(
    "flex flex-col items-start gap-0.5 rounded-[10px] border bg-panel px-3.5 py-2.5 text-left max-sm:px-2.5 max-sm:py-2",
    on ? "border-act bg-act-soft shadow-[0_0_0_1px_var(--color-act)]" : "border-rule",
    !locked && !on && "hover:border-act-line",
    locked && !on && "opacity-50",
  );

export function DealTiles({
  value,
  onChange,
  locked = false,
  unsure = false,
}: {
  value: ContractDeal;
  onChange: (d: ContractDeal) => void;
  locked?: boolean;
  /** V2-G: AI chưa chắc loại HĐ (bước xác nhận) ⇒ tô vàng khung + nhắc kiểm tra. */
  unsure?: boolean;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cform.${k}`);
  return (
    <div className="flex flex-col gap-1.5">
      <span id="deal-label" className="text-[13px]">
        {L("deal")}
      </span>
      <div
        role="radiogroup"
        aria-labelledby="deal-label"
        data-unsure={unsure || undefined}
        className={cn(
          "grid grid-cols-3 gap-2.5",
          unsure && "rounded-xl border border-soon-line bg-soon-bg p-1.5",
        )}
      >
        {DEALS.map((d) => (
          <SegButton
            key={d}
            checked={d === value}
            disabled={locked && d !== value}
            onClick={() => !locked && onChange(d)}
            className={tile(d === value, locked)}
          >
            <b className={cn("text-[14px]", d === value && "text-act")}>{L(`dealName.${d}`)}</b>
            <span className="text-[12.5px] text-dim max-sm:hidden">{L(`dealHint.${d}`)}</span>
          </SegButton>
        ))}
      </div>
      {unsure && <p className="text-[12px] text-soon">{L("dealUnsure")}</p>}
      {locked && <p className="text-[12px] text-dim">{L("dealLocked")}</p>}
    </div>
  );
}
