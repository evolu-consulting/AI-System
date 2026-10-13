// HUB-FR-128 · HUB-FR-119 · P-c1 §1.2 · khối "Kết quả tự sửa mã": đầu + diff theo `status`.
// Bản chép: admin-web `components/run/autofix/AutofixResult.tsx` (TECH-DEBT FC2). Hook tải ở `use-autofix-content`.
import type { AutofixStageView } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DIFF_LINES_MAX } from "../../../lib/diff-parse";
import { AutofixHead } from "./AutofixHead";
import { DiffView } from "./DiffView";
import { type LoadContent, useAutofixDiff, useDownload } from "./use-autofix-content";

type Props = { view: AutofixStageView; load: LoadContent };
const K = "process.common.autofix.";

function DiffBody({ view, load }: Props) {
  const { t } = useTranslation();
  const file = view.diff_file;
  const d = useAutofixDiff(file?.id ?? null, load);
  const download = useDownload(load);
  if (d.isError) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-1 rounded-md border border-destructive/40 p-2 text-sm"
      >
        <span className="font-medium">{t(`${K}loadErr.label`)}</span>
        <span className="text-caption text-muted-foreground">{t(`${K}loadErr.hint`)}</span>
        <span>
          <Button type="button" size="sm" variant="outline" onClick={() => void d.refetch()}>
            {t(`${K}retry`)}
          </Button>
        </span>
      </div>
    );
  }
  if (!d.parsed) return <Skeleton aria-busy="true" className="h-16 w-full" />;
  const rest = Math.max(d.parsed.totalLines - DIFF_LINES_MAX, 0);
  return (
    <>
      {d.parsed.truncated && (
        <p className="text-caption text-secondary-foreground">{t(`${K}big`, { rest })}</p>
      )}
      <DiffView parsed={d.parsed} />
      {d.parsed.truncated && file && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => void download(file)}
        >
          {t(`${K}downloadDiff`)}
        </Button>
      )}
    </>
  );
}

function AutofixResultImpl({ view, load }: Props) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t(`${K}region`)}
      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
    >
      <AutofixHead view={view} load={load} />
      {view.status === "ok" && view.diff_file && <DiffBody view={view} load={load} />}
      {view.status === "no_changes" && (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{t(`${K}noChanges.label`)}</span>
          <span className="text-caption text-muted-foreground">{t(`${K}noChanges.hint`)}</span>
        </div>
      )}
      {view.status === "check_failed" && (
        <span className="text-sm font-medium text-destructive">{t(`${K}checkFailed.label`)}</span>
      )}
    </section>
  );
}

export const AutofixResult = memo(AutofixResultImpl);
