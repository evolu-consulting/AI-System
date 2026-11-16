// PK-FR-10 · TF6 · ô tìm + bộ lọc riêng của trang (children) + số kết quả, một hàng tự xuống dòng. Nguồn: table.tsx:379-400.

import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { Input } from "@ai/web-kit/ui/kit/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function TableTools({
  q,
  setQ,
  placeholder,
  total,
  children,
}: {
  q: string;
  setQ: (v: string) => void;
  placeholder?: string;
  total: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-60 sm:max-w-xs">
        <svg
          width="15"
          height="15"
          viewBox="0 0 15 15"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim"
        >
          <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="m10 10 3.5 3.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? t("contracts.table.searchPlaceholder")}
          aria-label={t("contracts.table.search")}
          className="h-9 w-full pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="quiet"
                size="icon"
                className="absolute top-1/2 right-1 size-7 -translate-y-1/2 border-0 bg-transparent"
                aria-label={t("contracts.table.clearSearch")}
                onClick={() => setQ("")}
              >
                <ICONS.close className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("contracts.table.clearSearch")}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
      <span role="status" className="ml-auto text-label text-dim tabular-nums">
        {t("contracts.table.results", { n: total.toLocaleString("vi-VN") })}
      </span>
    </div>
  );
}
