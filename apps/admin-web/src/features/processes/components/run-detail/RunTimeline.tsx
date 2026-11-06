// CR-121 · R-3: dòng thời gian thu gọn được của lượt chạy; mục "chạy lại" có liên kết tới lượt liên quan (`ref_run_id`).

import type { RunTimelineItem } from "@ai/contracts/chat";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { companySearch } from "../../lib/company-copy";

type Props = { items: readonly RunTimelineItem[]; processKey: string; company?: string };

export function RunTimeline({ items, processKey, company }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "vi" ? "vi" : "en";
  const [open, setOpen] = useState(true);
  const T = (k: string) => t(`process.admin.runDetail.${k}`);
  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 p-3 text-left text-label font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-4 transition-transform", !open && "-rotate-90")}
        />
        {T("timeline")}
        <span className="font-normal text-muted-foreground">{items.length}</span>
      </button>
      {open && (
        <ol className="m-0 flex list-none flex-col gap-2 px-4 pb-4">
          {items.length === 0 && (
            <li className="text-body text-muted-foreground">{T("timelineEmpty")}</li>
          )}
          {items.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: dòng thời gian chỉ thêm cuối, đã sắp theo thời gian
            <li key={i} className="flex flex-wrap gap-x-3 text-body" data-kind={it.kind}>
              <span className="w-36 shrink-0 text-muted-foreground">{formatClock(it.at)}</span>
              <span className="min-w-0 flex-1 break-words">
                {it.text[lang]}
                {it.actor ? (
                  <span className="text-muted-foreground"> · {it.actor.display_name}</span>
                ) : null}
                {it.ref_run_id && (
                  <>
                    {" · "}
                    <Link
                      to="/processes/$processId/runs/$runId"
                      params={{ processId: processKey, runId: it.ref_run_id }}
                      search={companySearch(company)}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {T("openRelatedRun")}
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
