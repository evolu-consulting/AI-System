// CR-027 · logo hai biến thể (plan-frontend-theme §4): Sáng = ảnh logo ngang; Tối = icon + chữ HTML (logo ngang chỉ 1.29:1 trên nền tối).
import { BRAND_NAME, BRAND_TAGLINE } from "~/lib/brand";
import { cn } from "~/lib/utils";

type Props = { className?: string; imgClassName?: string };

export function BrandLogo({ className, imgClassName }: Props) {
  return (
    <span className={cn("inline-flex", className)}>
      <img
        src="/brand/evoluconsulting-logo-horizontal.svg"
        alt={BRAND_NAME}
        className={cn("dark:hidden", imgClassName)}
      />
      <span className="hidden items-center gap-2.5 dark:flex">
        <img src="/brand/evoluconsulting-icon.svg" alt="" aria-hidden className="size-10" />
        <span className="flex flex-col leading-tight">
          <span className="text-card-title font-semibold text-foreground">{BRAND_NAME}</span>
          <span className="text-micro tracking-[0.14em] text-subtle-foreground">
            {BRAND_TAGLINE}
          </span>
        </span>
      </span>
    </span>
  );
}
