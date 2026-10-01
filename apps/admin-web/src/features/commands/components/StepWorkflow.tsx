// ADM-FR-20 · ADM-BR-06 · bước 2 "Chọn workflow": Select Workflow (key + tên, workflow tắt mờ), thẻ tóm tắt, Alert workflow tắt / map bị bỏ.
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/shared/form/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTr } from "@/lib/use-translate";
import { useWorkflowOptions } from "../hooks/use-command-queries";
import type { CommandFormValues } from "../lib/schemas";
import { StepSection } from "./StepSection";
import { WorkflowCard } from "./WorkflowCard";

export type WorkflowNotice = { dropped: string[]; autoMapped: string[] };

type Props = {
  onChange: (workflowId: string) => void;
  notice: WorkflowNotice;
  /** Lỗi server `WORKFLOW_DISABLED` (hiện cùng Alert workflow tắt). */
  disabledByServer: boolean;
};

export function StepWorkflow({ onChange, notice, disabledByServer }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const { control, formState } = useFormContext<CommandFormValues>();
  const options = useWorkflowOptions();
  const [workflowId, enabled] = useWatch({ control, name: ["workflow_id", "enabled"] });
  const selected = options.data?.items.find((w) => w.id === workflowId);
  const off = !!selected && !selected.enabled && enabled;
  const err = formState.errors.workflow_id?.message;

  return (
    <StepSection n={2} title={t("commands.step2")}>
      <FormField
        id="cmd-workflow"
        label={t("commands.field.workflow")}
        error={err ? tr(err) : undefined}
      >
        {(p) => (
          <Controller
            control={control}
            name="workflow_id"
            render={({ field }) => (
              <Select value={field.value} onValueChange={onChange}>
                <SelectTrigger {...p} className="w-full max-w-md">
                  <SelectValue placeholder={t("commands.map.pickWorkflow")} />
                </SelectTrigger>
                <SelectContent>
                  {(options.data?.items ?? []).map((w) => (
                    <SelectItem
                      key={w.id}
                      value={w.id}
                      className={w.enabled ? undefined : "opacity-60"}
                    >
                      <span className="font-mono">{w.key}</span> · {w.name}
                      {w.enabled ? "" : ` (${t("common.off")})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>
      {selected ? <WorkflowCard workflow={selected} /> : null}
      {off || disabledByServer ? (
        <Alert variant="destructive">
          <AlertDescription>{t("commands.error.workflowDisabled")}</AlertDescription>
        </Alert>
      ) : null}
      {notice.dropped.length > 0 ? (
        <Alert>
          <AlertDescription>
            {t("commands.map.dropped", { names: notice.dropped.join(", ") })}
          </AlertDescription>
        </Alert>
      ) : null}
      {notice.autoMapped.length > 0 ? (
        <Alert>
          <AlertDescription>
            {t("commands.map.autoMapped", { names: notice.autoMapped.join(", ") })}
          </AlertDescription>
        </Alert>
      ) : null}
    </StepSection>
  );
}
