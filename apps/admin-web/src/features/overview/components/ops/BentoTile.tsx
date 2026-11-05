// CR-121 C-3b · ô bento dùng chung: tiêu đề + gợi ý "cách tính" + link vào trang chi tiết; trạng thái đang tải / lỗi (kèm lý do + Thử lại) của riêng từng ô.
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Info } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { LoadError } from "@/lib/load-error";
import { cn } from "@/lib/utils";
import type { OpsLink } from "../../lib/ops-overview";

export type TileError = LoadError & { onRetry?: () => void };

type Props = {
  title: string;
  /** Giải thích cách tính (nhãn nghiệp vụ, không thuật ngữ kỹ thuật). */
  tip?: string;
  /** Trang đích đã có; `null` = chưa có trang ⇒ không link. */
  link?: OpsLink | null;
  loading?: boolean;
  error?: TileError | null;
  className?: string;
  children: ReactNode;
};

export function BentoTile({ title, tip, link, loading, error, className, children }: Props) {
  const id = useId();
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby={id}
      aria-busy={loading || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-1 text-label text-muted-foreground">
        <h3 id={id} className="font-medium">
          {title}
        </h3>
        {tip ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("overview.ops.howCalc", { name: title })}
                  className="rounded-sm"
                >
                  <Info aria-hidden className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">{tip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        {link ? (
          <Link
            to={link.to}
            search={link.search as never}
            aria-label={t("overview.ops.openDetail", { name: title })}
            className="ml-auto rounded-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
      {error ? (
        <ErrorState {...error} />
      ) : loading ? (
        <div aria-hidden className="space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      ) : (
        children
      )}
    </section>
  );
}
