// HUB-FR-124 · AC-H37 · một trường của form `!key`, rẽ theo `type`: text / select / file / source_ref.
import type { ProcessInputDef } from "@ai/contracts/hub-admin";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { DATE_INPUT_INVALID_KEY } from "../../domain/date-input";
import { NUMBER_INPUT_INVALID_KEY } from "../../domain/number-input";
import type { FieldError, FieldValue } from "../lib/inputs-rules";
import { type ChipsState, SELECT_CLASS, SourceRefField } from "./SourceRefField";

export type FieldFile = { uploading: boolean; failed: boolean };

type Props = {
  def: ProcessInputDef;
  value: FieldValue;
  error?: FieldError;
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
        error={
          error === "tooLong" || error === "dateInvalid" || error === "numberInvalid"
            ? undefined
            : error
        }
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
  if (def.type === "number")
    return <TypedControl {...p} type="number" bad="numberInvalid" msg={NUMBER_INPUT_INVALID_KEY} />;
  if (def.type === "date")
    return <TypedControl {...p} type="date" bad="dateInvalid" msg={DATE_INPUT_INVALID_KEY} />;
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

/** Ô `date` / `number` của trình duyệt: giá trị chuỗi, lỗi `bad` ⇒ câu `msg` dưới ô. */
function TypedControl(p: Props & { type: "date" | "number"; bad: FieldError; msg: string }) {
  const { t } = useTranslation();
  return (
    <>
      <input
        type={p.type}
        step={p.type === "number" ? "any" : undefined}
        className={SELECT_CLASS}
        aria-label={p.def.label}
        value={p.value.value}
        disabled={p.disabled}
        aria-invalid={p.error ? true : undefined}
        onChange={(e) => p.onChange({ value: e.target.value })}
      />
      {p.error === p.bad && (
        <p role="alert" className="text-caption text-destructive">
          {t(p.msg)}
        </p>
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
