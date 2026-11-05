// V2-I · DT-04 · mockup NITI `.stars`: chọn 1–5 sao cho một tiêu chí (radiogroup); bấm lại sao đang chọn = bỏ chọn.
import { useTranslation } from "react-i18next";
import { SegButton } from "~/components/shared/seg-button";
import { cn } from "~/lib/utils";

export function Stars({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <SegButton
          key={i}
          checked={value === i}
          disabled={disabled}
          onClick={() => onChange(value === i ? 0 : i)}
          className={cn(
            "h-8 w-8 rounded-md text-[20px] leading-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            value >= i ? "text-soon" : "text-field hover:text-ink-2",
          )}
        >
          <span aria-hidden="true">★</span>
          <span className="sr-only">{t("contracts.pv2.review.starsN", { n: i })}</span>
        </SegButton>
      ))}
    </div>
  );
}
