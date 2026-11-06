// ADM-FR-60 · H1 + mô tả + vùng nút phải; H1 nhận focus khi vào trang (a11y). CR-112: nhúng trong workspace ⇒ h2, không cướp focus.
import { Info } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEmbedded } from "./embedded";

type Props = { title: string; description?: string; actions?: ReactNode; hint?: string };

export function PageHeader({ title, description, actions, hint }: Props) {
  const ref = useRef<HTMLHeadingElement>(null);
  const embedded = useEmbedded();
  useEffect(() => {
    if (!embedded) ref.current?.focus({ preventScroll: true });
  }, [embedded]);
  const Heading = embedded ? "h2" : "h1";
  return (
    <header
      className={
        embedded
          ? "mb-4 flex flex-wrap items-start justify-between gap-4"
          : "mb-6 flex flex-wrap items-start justify-between gap-4"
      }
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Heading
            ref={ref}
            tabIndex={-1}
            className={
              embedded
                ? "text-h3 font-semibold text-foreground outline-none"
                : "text-page-title font-bold text-foreground outline-none"
            }
          >
            {title}
          </Heading>
          {hint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={hint}
                  className="inline-flex rounded-full text-muted-foreground"
                >
                  <Info aria-hidden className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {description ? <p className="mt-1 text-body text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
