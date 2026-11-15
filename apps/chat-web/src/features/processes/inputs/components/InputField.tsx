// HUB-FR-124 · AC-H37 · một trường của form `!key`, rẽ theo `type`: text / select / file / source_ref.

import { ATTACH_ALLOWED, ATTACH_MAX_BYTES } from "@ai/contracts/chat";
import type { ProcessInputDef } from "@ai/contracts/hub-admin";
import { attachPickLabels } from "@ai/web-kit/attach-layout";
import { AttachDraftList, type DraftItem } from "@ai/web-kit/ui/AttachDraft";
import { AttachDropzone } from "@ai/web-kit/ui/AttachDropzone";
import { DateInput } from "@ai/web-kit/ui/DateInput";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "~/components/ui/textarea";
import { attachLabels } from "~/features/attachments/lib/attachView";
import { DATE_INPUT_INVALID_KEY } from "../../domain/date-input";
import { NUMBER_INPUT_INVALID_KEY } from "../../domain/number-input";
import type { FieldError, FieldValue } from "../lib/inputs-rules";
import { type ChipsState, SELECT_CLASS, SourceRefField } from "./SourceRefField";

const ATTACH_ACCEPT = Object.keys(ATTACH_ALLOWED)
  .map((ext) => `.${ext}`)
  .join(",");

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
  if (def.type === "date") return <DateControl {...p} />;
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
function TypedControl(p: Props & { type: "number"; bad: FieldError; msg: string }) {
  const { t } = useTranslation();
  return (
    <>
      <input
        // `number` dùng ô chữ + bàn phím số: ô `type=number` trả "" khi gõ sai (bong bóng gốc, mất câu i18n — UAT B-D2-1).
        type="text"
        inputMode="decimal"
        data-input-type={p.type}
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

/** Ô ngày dùng chung (dd/mm/yyyy, gõ hoặc chọn lịch); sai ngày ⇒ câu `dateInvalid` dưới ô. */
function DateControl(p: Props) {
  const { t } = useTranslation();
  return (
    <>
      <DateInput
        aria-label={p.def.label}
        inputClassName={SELECT_CLASS}
        className="w-full"
        value={p.value.value}
        disabled={p.disabled}
        onChange={(e) => p.onChange({ value: e.target.value })}
      />
      {p.error === "dateInvalid" && (
        <p role="alert" className="text-caption text-destructive">
          {t(DATE_INPUT_INVALID_KEY)}
        </p>
      )}
    </>
  );
}

function FileControl({ def, value, file, disabled, onChange, onFile }: Props) {
  const { t, i18n } = useTranslation();
  const [picked, setPicked] = useState("");
  const name = file.uploading || file.failed ? picked : value.fileName;
  const items: DraftItem[] = name
    ? [
        {
          id: "file",
          name,
          mime: "",
          status: file.uploading ? "uploading" : file.failed ? "error" : "ready",
          ...(file.failed ? { errorText: t("process.inputs.field.file.error") } : {}),
        },
      ]
    : [];
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="sr-only">{def.label}</legend>
      <AttachDropzone
        variant={items.length > 0 ? "compact" : "full"}
        multiple={false}
        labels={attachPickLabels(t, "attach.pick")}
        accept={ATTACH_ACCEPT}
        maxBytes={ATTACH_MAX_BYTES}
        disabled={disabled}
        busy={file.uploading}
        locale={i18n.language}
        onFiles={(fs) => {
          const f = fs[0];
          if (!f) return;
          setPicked(f.name);
          onFile(f);
        }}
      />
      <AttachDraftList
        items={items}
        labels={attachLabels(t)}
        layout="stack"
        locale={i18n.language}
        onRemove={() => onChange({ value: "", fileName: "" })}
      />
    </fieldset>
  );
}
