// ADM-FR-68 · HUB-BR-30 · trường theo loại nguồn: git (url + nhánh + ghi chú kho công khai), library (picker tài liệu), local_path (đường dẫn + cảnh báo).
// Không có ô mật khẩu/token (D2). `path` chỉ tồn tại trong cây này khi form do platform_admin mở (controller không cấp cho vai khác).
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LibraryDocPickerData } from "../hooks/use-library-doc-picker";
import type { SourceFormValues } from "../lib/schemas";
import { ApplyModeField } from "./ApplyModeField";
import { CredentialField } from "./CredentialField";
import { LibraryDocPicker } from "./LibraryDocPicker";
import { LocalPathWarning } from "./LocalPathWarning";

type Props = {
  form: UseFormReturn<SourceFormValues>;
  formId: string;
  /** Câu lỗi đã dịch theo ô (client + server). */
  error: (f: keyof SourceFormValues) => string | undefined;
  picker: LibraryDocPickerData;
  /** Công ty đang xem (platform chọn) — để tải khoá nguồn của đúng tenant. */
  tenantId: string | undefined;
};

function GitFields({ form, formId, error, tenantId }: Omit<Props, "picker">) {
  const { t } = useTranslation();
  const url = form.watch("url");
  return (
    <>
      <FormField id={`${formId}-url`} label={t("process.sources.field.url")} error={error("url")}>
        {(p) => (
          <Input
            {...p}
            {...form.register("url")}
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            className="font-mono"
          />
        )}
      </FormField>
      <FormField
        id={`${formId}-branch`}
        label={t("process.sources.field.branch")}
        error={error("branch")}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("branch")}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </FormField>
      <CredentialField
        id={`${formId}-credential`}
        tenantId={tenantId}
        value={form.watch("credential_secret_id")}
        onChange={(id) => form.setValue("credential_secret_id", id, { shouldDirty: true })}
        error={error("credential_secret_id")}
      />
      <ApplyModeField
        id={`${formId}-applymode`}
        url={url}
        value={form.watch("apply_mode")}
        onChange={(m) => form.setValue("apply_mode", m, { shouldDirty: true })}
        error={error("apply_mode")}
      />
    </>
  );
}

function LibraryField({ form, formId, error, picker }: Props) {
  const { t } = useTranslation();
  const docId = form.watch("document_id");
  const version = picker.items.find((d) => d.id === docId)?.version;
  return (
    <FormField
      id={`${formId}-doc`}
      label={t("process.sources.field.document")}
      error={error("document_id")}
      description={
        version
          ? t("process.sources.field.documentVersion", { version: version.slice(0, 8) })
          : undefined
      }
    >
      {(p) => (
        <LibraryDocPicker
          id={p.id}
          value={docId}
          picker={picker}
          invalid={!!p["aria-invalid"]}
          describedBy={p["aria-describedby"]}
          onChange={(id) =>
            form.setValue("document_id", id, { shouldDirty: true, shouldValidate: true })
          }
        />
      )}
    </FormField>
  );
}

function LocalFields({ form, formId, error }: Omit<Props, "picker" | "tenantId">) {
  const { t } = useTranslation();
  return (
    <>
      <FormField
        id={`${formId}-path`}
        label={t("process.sources.field.path")}
        error={error("path")}
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("path")}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </FormField>
      <LocalPathWarning />
      <div className="space-y-1.5">
        <Label>{t("process.sources.applyMode.label")}</Label>
        <div>
          <Badge variant="secondary">{t("process.sources.applyMode.local")}</Badge>
        </div>
        <p className="text-caption text-muted-foreground">
          {t("process.sources.applyMode.local.hint")}
        </p>
      </div>
    </>
  );
}

export function KindFields(p: Props) {
  const kind = p.form.watch("kind");
  if (kind === "git_remote")
    return <GitFields form={p.form} formId={p.formId} error={p.error} tenantId={p.tenantId} />;
  if (kind === "library") return <LibraryField {...p} />;
  return <LocalFields form={p.form} formId={p.formId} error={p.error} />;
}
