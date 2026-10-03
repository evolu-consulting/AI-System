// ADM-FR-54 · M4-R14 · M4-R15 · M4-AC09/10 · tab Import (ms §8, artboard ImportPreview): Chọn file → Xem trước → Áp dụng.
import { IMPORT_ITEM_TYPES, type ImportItem } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Accordion } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadError } from "@/lib/load-error";
import { cn } from "@/lib/utils";
import { secretValueOk, useImportApply } from "../hooks/use-import-apply";
import { type ImportFlow, useImportPreview } from "../hooks/use-import-preview";
import { formatFileSize } from "../lib/import-file";
import { ImportDrop } from "./ImportDrop";
import { ImportErrors } from "./ImportErrors";
import { ImportGroup } from "./ImportGroup";
import { type ImportFilter, ImportSummary } from "./ImportSummary";
import { MissingSecrets } from "./MissingSecrets";

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  return (
    <ol aria-label={t("transfer.import.steps")} className="flex flex-wrap gap-6 text-label">
      {([1, 2, 3] as const).map((n) => (
        <li
          key={n}
          aria-current={n === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-2",
            n === current ? "font-semibold" : "text-muted-foreground",
          )}
        >
          <span className="flex size-6 items-center justify-center rounded-full border">{n}</span>
          {t(`transfer.import.step${n}`)}
        </li>
      ))}
    </ol>
  );
}

function ItemGroups({ items, filter }: { items: ImportItem[]; filter: ImportFilter | null }) {
  const { t } = useTranslation();
  const shown = filter === null ? items : items.filter((i) => i.op === filter);
  if (filter === "unchanged") {
    return <p className="text-body text-muted-foreground">{t("transfer.import.unchangedNote")}</p>;
  }
  return (
    <Accordion
      type="multiple"
      defaultValue={[...IMPORT_ITEM_TYPES]}
      className="rounded-lg border px-4"
    >
      {IMPORT_ITEM_TYPES.map((type) => {
        const list = shown.filter((i) => i.type === type);
        return list.length ? <ImportGroup key={type} type={type} items={list} /> : null;
      })}
    </Accordion>
  );
}

function ApplyBar({ flow, x }: { flow: ImportFlow; x: ReturnType<typeof useImportApply> }) {
  const { t } = useTranslation();
  const file = flow.file?.name ?? "";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={x.missingCount > 0 || flow.pending} onClick={() => x.setConfirming(true)}>
        {t("transfer.import.apply", { n: x.changes })}
      </Button>
      {x.missingCount > 0 ? (
        <p role="status" className="text-label text-muted-foreground">
          {t("transfer.import.secretsMissing", { n: x.missingCount })}
        </p>
      ) : null}
      <ConfirmDialog
        open={x.confirming}
        onOpenChange={x.setConfirming}
        title={t("transfer.import.confirm.title", { n: x.changes, file })}
        description={t("transfer.import.confirm.body")}
        confirmLabel={t("common.confirm")}
        onConfirm={x.apply}
      />
    </div>
  );
}

function PreviewBody({ flow, x }: { flow: ImportFlow; x: ReturnType<typeof useImportApply> }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ImportFilter | null>(null);
  const p = flow.preview;
  if (flow.tooLarge)
    return (
      <p role="alert" className="text-label text-destructive">
        {t("transfer.import.tooLarge")}
      </p>
    );
  if (flow.errors) return <ImportErrors errors={flow.errors} />;
  if (flow.failed) {
    const err = loadError(flow.failed) ?? { message: t("common.unavailable"), code: "HTTP_ERROR" };
    return <ErrorState {...err} onRetry={flow.retry} />;
  }
  if (!p || (flow.pending && !flow.stale)) return <PreviewSkeleton />;
  if (x.changes === 0) return <p className="text-body">{t("transfer.import.nothing")}</p>;
  return (
    <div className="space-y-4">
      <ImportSummary summary={p.summary} filter={filter} onFilter={setFilter} />
      <ItemGroups items={p.items} filter={filter} />
      {p.missing_secrets.length > 0 ? (
        <MissingSecrets
          secrets={p.missing_secrets}
          values={x.values}
          isValid={secretValueOk}
          onChange={x.setValue}
        />
      ) : null}
      <p className="text-label text-muted-foreground">{t("transfer.import.noDelete")}</p>
      <ApplyBar flow={flow} x={x} />
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function FileLine({ flow }: { flow: ImportFlow }) {
  const { t, i18n } = useTranslation();
  const f = flow.file;
  if (!f) return null;
  const valid = flow.preview?.valid === true;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-body">
        {valid
          ? t("transfer.import.file", { file: f.name, size: formatFileSize(f.size, i18n.language) })
          : f.name}
      </span>
      <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={flow.reset}>
        {t("transfer.import.another")}
      </Button>
    </div>
  );
}

export function ImportTab() {
  const { t } = useTranslation();
  const flow = useImportPreview();
  const x = useImportApply(flow);
  const step = !flow.file ? 1 : x.confirming ? 3 : 2;
  const stale = flow.stale && !flow.pending;
  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <Steps current={step} />
        {!flow.file ? (
          <ImportDrop problem={flow.problem} onPick={(f) => void flow.pick(f)} />
        ) : (
          <>
            <FileLine flow={flow} />
            {stale ? (
              <Alert>
                <AlertDescription>{t("transfer.import.stale")}</AlertDescription>
              </Alert>
            ) : null}
            <PreviewBody flow={flow} x={x} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
