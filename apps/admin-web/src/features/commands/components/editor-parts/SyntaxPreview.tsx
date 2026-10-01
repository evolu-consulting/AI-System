// ADM-FR-20 · bước 3 · cú pháp người dùng gõ, cập nhật ngay khi sửa tên/tham số (chỉ đọc).
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { CommandFormValues } from "../../lib/schemas";
import { buildSyntax } from "../../lib/syntax";

export function SyntaxPreview() {
  const { t } = useTranslation();
  const { control } = useFormContext<CommandFormValues>();
  const [name, args] = useWatch({ control, name: ["name", "args"] });
  return (
    <div className="space-y-1">
      <p className="text-label font-medium">{t("commands.args.syntax")}</p>
      <code className="block rounded-md border border-border bg-muted px-3 py-2 font-mono text-body">
        {buildSyntax(name, args)}
      </code>
    </div>
  );
}
