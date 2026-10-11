// HUB-FR-124 · AC-H37 · một trường của form `!key`, rẽ theo `type`: text / select / file / source_ref.
import type { ProcessInputDef } from "@ai/contracts/hub-admin";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import type { FieldValue } from "../lib/inputs-rules";
import { type ChipsState, SELECT_CLASS, SourceRefField } from "./SourceRefField";

export type FieldFile = { uploading: boolean; failed: boolean };

type Props = {
  def: ProcessInputDef;
  value: FieldValue;
  error?: "tooLong" | "required" | "dash";
  file: FieldFile;
  chips: ChipsState;
  disabled: boolean;
  onChange(patch: Partial<FieldValue>): void;
  onSource(sourceKey: string): void;
  onFile(file: File): void;
};

export function InputField(p: Props) {
  const { t } = useTranslation();
  const { def } = p;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{def.label}</span>
        {def.required && (
          <span className="text-caption text-muted-foreground">
            {t("process.inputs.form.required")}
          </span>
        )}
      </div>
      <Control {...p} />
    </div>
  );
}

function Control(p: Props) {
  const { t } = useTranslation();
  const { def, value, error } = p;
  if (def.type === "source_ref") {
    return (
      <SourceRefField
        def={def}
        value={value}
        error={error === "tooLong" ? undefined : error}
        chips={p.chips}
        disabled={p.disabled}
        onSource={p.onSource}
        onBranch={(branch) => p.onChange({ branch })}
      />
    );
  }
  if (def.type === "select") {
    return (
      <select
        className={SELECT_CLASS}
        aria-label={def.label}
        value={value.value}
        disabled={p.disabled}
        onChange={(e) => p.onChange({ value: e.target.value })}
      >
        <option value="">{t("process.inputs.field.select.placeholder")}</option>
        {(def.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (def.type === "file") return <FileControl {...p} />;
  return (
    <>
      <Textarea
        aria-label={def.label}
        rows={3}
        value={value.value}
        disabled={p.disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => p.onChange({ value: e.target.value })}
      />
      {error === "tooLong" && (
        <p className="text-caption text-destructive">{t("process.inputs.err.text.tooLong")}</p>
      )}
    </>
  );
}

function FileControl({ def, value, file, disabled, onChange, onFile }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || file.uploading}
          onClick={() => ref.current?.click()}
        >
          {t("process.inputs.field.file.pick", { label: def.label })}
        </Button>
        {value.fileName && (
          <>
            <span className="truncate text-sm">{value.fileName}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange({ value: "", fileName: "" })}
            >
              {t("process.inputs.field.file.remove")}
            </Button>
          </>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        tabIndex={-1}
        aria-hidden
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      {file.uploading && (
        <div className="flex flex-col gap-1" aria-live="polite">
          <div
            role="progressbar"
            aria-label={t("process.inputs.field.file.uploading")}
            className="h-1 w-full animate-pulse rounded bg-primary/40"
          />
          <p className="text-caption text-muted-foreground">
            {t("process.inputs.field.file.uploading")}
          </p>
        </div>
      )}
      {file.failed && (
        <p role="alert" className="text-caption text-destructive">
          {t("process.inputs.field.file.error")}
        </p>
      )}
    </div>
  );
}
