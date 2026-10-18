// ADM-FR-66 · CR-056 · P-a F5: phần "kết quả" của một giai đoạn — tên tệp, mẫu, mục bắt buộc (chip), trường có cấu trúc.
import { STAGE_SECTIONS_MAX } from "@ai/contracts/hub-admin";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DraftErrors, StageDraft } from "../../lib/def-form";
import { TextField } from "./Fields";
import { OutputFields } from "./OutputFields";

type Props = {
  stage: StageDraft;
  index: number;
  errors: DraftErrors;
  readOnly: boolean;
  onChange: (patch: Partial<StageDraft>) => void;
};

function Sections({ stage, index, errors, readOnly, onChange }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const err = errors[`stages.${index}.output.required_sections`];
  const id = `${stage.uid}-sections`;
  const add = () => {
    const v = text.trim();
    if (v !== "" && !stage.sections.includes(v) && stage.sections.length < STAGE_SECTIONS_MAX)
      onChange({ sections: [...stage.sections, v] });
    setText("");
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("process.admin.editor.stage.sections")}</Label>
      <ul className="flex flex-wrap gap-1.5">
        {stage.sections.map((s) => (
          <li
            key={s}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-label"
          >
            {s}
            {readOnly ? null : (
              <button
                type="button"
                aria-label={t("process.admin.editor.stage.removeSection", { name: s })}
                onClick={() => onChange({ sections: stage.sections.filter((x) => x !== s) })}
                className="rounded-full p-0.5 hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X aria-hidden className="size-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {readOnly ? null : (
        <div className="flex gap-2">
          <Input
            id={id}
            value={text}
            maxLength={80}
            aria-invalid={err ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
          />
          <Button type="button" variant="outline" onClick={add}>
            {t("process.admin.editor.stage.addSection")}
          </Button>
        </div>
      )}
      {err ? <p className="text-caption text-destructive">{t(err)}</p> : null}
    </div>
  );
}

export function StageOutput(p: Props) {
  const { t } = useTranslation();
  const { stage, index, errors, readOnly } = p;
  const e = (f: string): string | undefined => {
    const k = errors[`stages.${index}.${f}`];
    return k ? t(k) : undefined;
  };
  return (
    <div className="space-y-3">
      <TextField
        id={`${stage.uid}-file`}
        label={t("process.admin.editor.stage.filename")}
        value={stage.filename}
        error={e("output.filename")}
        readOnly={readOnly}
        mono
        onChange={(v) => p.onChange({ filename: v })}
      />
      <TextField
        id={`${stage.uid}-tpl`}
        label={t("process.admin.editor.stage.template")}
        value={stage.template}
        error={e("output.template")}
        readOnly={readOnly}
        multiline
        rows={5}
        mono
        onChange={(v) => p.onChange({ template: v })}
      />
      <Sections {...p} />
      <OutputFields {...p} />
    </div>
  );
}
