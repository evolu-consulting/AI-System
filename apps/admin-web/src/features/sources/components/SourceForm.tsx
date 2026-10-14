// ADM-FR-68 · PB-R21 · form trong drawer: Ký hiệu [mới] · Loại (radiogroup) · trường theo loại · Công ty [platform, mới] · Mô tả.
// Gating quyền: tenant_admin KHÔNG có radio `local_path` (không tồn tại trong DOM) và không bao giờ nhận KindFields của local_path.
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTr } from "@/lib/use-translate";
import type { LibraryDocPickerData } from "../hooks/use-library-doc-picker";
import {
  type SourceFormErrors,
  type SourceFormMode,
  type SourceFormValues,
  sourceResolver,
} from "../lib/schemas";
import { SOURCE_KINDS_UI } from "../lib/source-kinds";
import { KindFields } from "./KindFields";

export type SourceFormProps = {
  formId: string;
  mode: SourceFormMode;
  isPlatform: boolean;
  /** Công ty đang xem — để tải khoá nguồn của đúng tenant (ô "Khoá nguồn"). */
  tenantId: string | undefined;
  defaults: SourceFormValues;
  tenants: { id: string; key: string }[];
  picker: LibraryDocPickerData;
  /** Lỗi server đã dịch theo ô. */
  serverErrors: SourceFormErrors;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (values: SourceFormValues) => void | Promise<void>;
};

const DESC_MAX = 500;

export function SourceForm(p: SourceFormProps) {
  const { t } = useTranslation();
  const tr = useTr();
  const form = useForm<SourceFormValues>({
    resolver: sourceResolver({ mode: p.mode, isPlatform: p.isPlatform }),
    mode: "onTouched",
    defaultValues: p.defaults,
  });
  const { errors, isDirty } = form.formState;
  const kind = form.watch("kind");
  const isNew = p.mode === "new";
  useEffect(() => p.onDirtyChange(isDirty), [isDirty, p.onDirtyChange]);
  useEffect(() => {
    const first = (["key", "url", "branch", "path", "description"] as const).find(
      (k) => p.serverErrors[k],
    );
    if (first) form.setFocus(first);
  }, [p.serverErrors, form]);
  const error = (f: keyof SourceFormValues): string | undefined => {
    const m = errors[f]?.message;
    return (m ? tr(m) : undefined) ?? p.serverErrors[f];
  };
  const kinds = SOURCE_KINDS_UI.filter((k) => k !== "local_path" || p.isPlatform);
  const showFields = kind !== "local_path" || p.isPlatform;
  const descLen = form.watch("description").length;

  return (
    <form id={p.formId} onSubmit={form.handleSubmit(p.onSubmit)} noValidate className="space-y-4">
      {isNew ? (
        <FormField
          id={`${p.formId}-key`}
          label={t("process.sources.field.key")}
          description={t("process.sources.field.keyHint")}
          error={error("key")}
        >
          {(f) => (
            <Input
              {...f}
              {...form.register("key")}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
      ) : null}
      <div className="space-y-1.5">
        <Label id={`${p.formId}-kind-label`}>{t("process.sources.field.kind")}</Label>
        <RadioGroup
          aria-labelledby={`${p.formId}-kind-label`}
          value={kind}
          disabled={!isNew}
          onValueChange={(v) =>
            form.setValue("kind", v as SourceFormValues["kind"], { shouldDirty: true })
          }
        >
          {kinds.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <RadioGroupItem id={`${p.formId}-kind-${k}`} value={k} />
              <Label htmlFor={`${p.formId}-kind-${k}`} className="font-normal">
                {t(`process.sources.kind.${k}`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      {showFields ? (
        <KindFields
          form={form}
          formId={p.formId}
          error={error}
          picker={p.picker}
          tenantId={p.tenantId}
        />
      ) : null}
      {isNew && p.isPlatform ? (
        <FormField
          id={`${p.formId}-tenant`}
          label={t("process.sources.field.tenant")}
          error={error("tenant")}
        >
          {(f) => (
            <Select
              value={form.watch("tenant")}
              onValueChange={(v) =>
                form.setValue("tenant", v, { shouldDirty: true, shouldValidate: true })
              }
            >
              <SelectTrigger
                {...f}
                aria-label={t("process.sources.field.tenant")}
                className="w-full"
              >
                <SelectValue placeholder={t("process.sources.field.tenantPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {p.tenants.map((tn) => (
                  <SelectItem key={tn.id} value={tn.key} className="font-mono">
                    {tn.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      ) : null}
      <FormField
        id={`${p.formId}-desc`}
        label={t("process.sources.field.desc")}
        description={t("process.sources.field.descHint")}
        error={error("description")}
      >
        {(f) => <Textarea {...f} {...form.register("description")} rows={3} />}
      </FormField>
      <p className="-mt-2 text-right text-caption text-muted-foreground" aria-hidden>
        {t("process.sources.field.descCount", { n: descLen, max: DESC_MAX })}
      </p>
    </form>
  );
}
