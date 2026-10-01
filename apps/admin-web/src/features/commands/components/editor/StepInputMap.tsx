// ADM-FR-21, ADM-FR-22 · AC-A03 · bước 4 "Đưa vào workflow": một dòng cho mỗi input của workflow, chặn lưu khi thiếu input bắt buộc.
import type { Workflow } from "@ai/contracts";
import { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { describeInputMapErrors } from "@/lib/errors";
import { useTr } from "@/lib/use-translate";
import type { MapIssues } from "../../hooks/use-command-form";
import { type MapWarning, validateInputMap } from "../../lib/input-map";
import type { CommandFormValues } from "../../lib/schemas";
import { InputMapRow } from "./InputMapRow";
import { StepSection } from "./StepSection";

type Props = {
  workflow: Workflow | undefined;
  /** Lỗi sau khi bấm Lưu (client chặn hoặc `INPUT_MAP_INVALID` của server). */
  issues: MapIssues | undefined;
};

export function StepInputMap({ workflow, issues }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const { control } = useFormContext<CommandFormValues>();
  const [map, args] = useWatch({ control, name: ["input_map", "args"] });
  const inputs = workflow?.input_schema ?? [];
  const check = useMemo(() => validateInputMap(inputs, args, map), [inputs, args, map]);
  // Cùng luật với server (M2-R17) nên chỉ dùng cảnh báo tính ở client: luôn khớp với giá trị đang sửa.
  const warnings = new Map<string, MapWarning>(check.warnings.map((w) => [w.var, w]));
  const stillMissing = new Set(check.missing);
  const messages = issues
    ? describeInputMapErrors({
        missing: issues.missing,
        unknown: issues.unknown,
        unknown_args: issues.unknownArgs,
      })
    : [];
  const argNames = args.map((a) => a.name).filter((n) => n !== "");

  return (
    <StepSection n={4} title={t("commands.step4")}>
      {messages.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            {messages.map((m) => (
              <p key={m.key}>{tr(m.key, m.params)}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {!workflow ? (
        <p className="text-body text-muted-foreground">{t("commands.map.pickWorkflow")}</p>
      ) : inputs.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("commands.map.noInputs")}</p>
      ) : (
        <div>
          {inputs.map((input) => (
            <InputMapRow
              key={input.name}
              input={input}
              entry={map[input.name] ?? { source: "", value: "" }}
              argNames={argNames}
              invalid={!!issues && stillMissing.has(input.name)}
              warning={warnings.get(input.name)}
            />
          ))}
        </div>
      )}
    </StepSection>
  );
}
