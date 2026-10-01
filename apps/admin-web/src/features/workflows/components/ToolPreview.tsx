// ADM-FR-11 · tab "Model thấy gì": JSON tool chỉ đọc dựng từ giá trị đang soạn (không gọi server).
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { WorkflowFormValues } from "../lib/schemas";
import { toToolPreview } from "../lib/tool-preview";

export function ToolPreview() {
  const { t } = useTranslation();
  const { control } = useFormContext<WorkflowFormValues>();
  const [key, description, input_schema] = useWatch({
    control,
    name: ["key", "description", "input_schema"],
  });
  const preview = toToolPreview({ key, description, input_schema });
  return (
    <div className="space-y-2">
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: vùng cuộn được bằng bàn phím
        tabIndex={0}
        className="max-h-[28rem] overflow-auto rounded-md border border-border bg-muted p-4 font-mono text-caption"
      >
        {JSON.stringify(preview, null, 2)}
      </pre>
      <p className="text-caption text-muted-foreground">{t("workflows.preview.note")}</p>
    </div>
  );
}
