// ADM-FR-68 · HUB-BR-30 · trường theo loại nguồn: git (url + nhánh + ghi chú kho công khai), library (picker tài liệu), local_path (đường dẫn + cảnh báo).
// Không có ô mật khẩu/token (D2). `path` chỉ tồn tại trong cây này khi form do platform_admin mở (controller không cấp cho vai khác).
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import type { LibraryDocPickerData } from "../hooks/use-library-doc-picker";
import type { SourceFormValues } from "../lib/schemas";
import { LibraryDocPicker } from "./LibraryDocPicker";
import { LocalPathWarning } from "./LocalPathWarning";

type Props = {
  form: UseFormReturn<SourceFormValues>;
  formId: string;
  /** Câu lỗi đã dịch theo ô (client + server). */
  error: (f: keyof SourceFormValues) => string | undefined;
  picker: LibraryDocPickerData;
};

function GitFields({ form, formId, error }: Omit<Props, "picker">) {
  const { t } = useTranslation();
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
      <Alert role="note">
        <AlertDescription>{t("process.sources.git.publicOnly")}</AlertDescription>
      </Alert>
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

function LocalFields({ form, formId, error }: Omit<Props, "picker">) {
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
    </>
  );
}

export function KindFields(p: Props) {
  const kind = p.form.watch("kind");
  if (kind === "git_remote") return <GitFields form={p.form} formId={p.formId} error={p.error} />;
  if (kind === "library") return <LibraryField {...p} />;
  return <LocalFields form={p.form} formId={p.formId} error={p.error} />;
}
