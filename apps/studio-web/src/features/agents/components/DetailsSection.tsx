// HUB-FR-60 · H4a-R03 · bước ① Thông tin: key (khoá khi sửa), tên VI/EN, mô tả cho Orchestrator (20–400, chặn), bật agent.
import { useTranslation } from "react-i18next";
import { Input } from "#/components/ui/input";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { Field, type SectionProps } from "./AgentField";

export function DetailsSection({ draft, set, errors, mode }: SectionProps) {
  const { t } = useTranslation();
  const len = draft.description.trim().length;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Field
          id="f-key"
          label={t("editor.field.key")}
          error={errors.key}
          hint={mode === "edit" ? t("editor.keyLocked") : undefined}
        >
          {(c) => (
            <Input
              {...c}
              value={draft.key}
              readOnly={mode === "edit"}
              autoComplete="off"
              onChange={(e) => set("key", e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field id="f-name-vi" label={t("editor.field.nameVi")} error={errors["name.vi"]}>
        {(c) => (
          <Input {...c} value={draft.nameVi} onChange={(e) => set("nameVi", e.target.value)} />
        )}
      </Field>
      <Field id="f-name-en" label={t("editor.field.nameEn")} error={errors["name.en"]}>
        {(c) => (
          <Input {...c} value={draft.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
        )}
      </Field>
      <div className="md:col-span-2">
        <Field
          id="f-desc"
          label={t("editor.field.description")}
          error={errors.description}
          hint={`${t("editor.descHint")} ${t("editor.counter", { n: len })}`}
        >
          {(c) => (
            <Textarea
              {...c}
              rows={3}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="flex items-center gap-2 md:col-span-2">
        <Switch id="f-enabled" checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
        <label htmlFor="f-enabled" className="text-body">
          {t("editor.field.enabled")}
        </label>
      </div>
    </div>
  );
}
