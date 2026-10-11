// HUB-FR-124 · AC-H37 · trường `source_ref`: chọn nguồn Git (chip) + nhánh điền sẵn `default_branch`.
import type { ProcessInputDef, ProcessSourceChip } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import type { BranchError, FieldValue } from "../lib/inputs-rules";

export type ChipsState = {
  git: ProcessSourceChip[];
  loading: boolean;
  failed: boolean;
  retry(): void;
};

type Props = {
  def: ProcessInputDef;
  value: FieldValue;
  error?: BranchError;
  chips: ChipsState;
  disabled: boolean;
  onSource(sourceKey: string): void;
  onBranch(branch: string): void;
};

export const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

export function SourceRefField({ def, value, error, chips, disabled, onSource, onBranch }: Props) {
  const { t } = useTranslation();
  const errId = `err-${def.key}`;
  const empty = chips.git.length === 0 && !chips.failed;
  return (
    <div className="flex flex-col gap-2">
      {chips.loading ? (
        <Skeleton className="h-9 w-full" aria-label={t("process.inputs.sources.loading")} />
      ) : (
        <select
          className={SELECT_CLASS}
          aria-label={t("process.inputs.field.source", { label: def.label })}
          value={value.value}
          disabled={disabled || chips.failed || chips.git.length === 0}
          onChange={(e) => onSource(e.target.value)}
        >
          <option value="">
            {empty
              ? t("process.inputs.sources.empty")
              : t("process.inputs.field.sourcePlaceholder")}
          </option>
          {chips.git.map((c) => (
            <option key={c.key} value={c.key} title={c.description}>
              {c.description ? `${c.key} — ${c.description}` : c.key}
            </option>
          ))}
        </select>
      )}
      {chips.failed && (
        <div className="flex items-center gap-2 text-caption text-destructive">
          <span role="alert">{t("process.inputs.sources.error")}</span>
          <Button type="button" size="sm" variant="outline" onClick={chips.retry}>
            {t("process.common.error.retry")}
          </Button>
        </div>
      )}
      <Input
        aria-label={t("process.inputs.field.branch", { label: def.label })}
        placeholder={t("process.inputs.field.branchPlaceholder")}
        value={value.branch}
        disabled={disabled || !value.value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onBranch(e.target.value)}
      />
      {error && (
        <p id={errId} className="text-caption text-destructive">
          {t(`process.inputs.err.branch.${error}`)}
        </p>
      )}
    </div>
  );
}
