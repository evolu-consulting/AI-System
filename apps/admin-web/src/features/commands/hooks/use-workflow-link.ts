// ADM-FR-20 · bước 2 → 4 · gắn command với workflow: nạp input schema, điền sẵn output field, gộp input map khi đổi workflow (ui-admin 7.4).
import type { Workflow } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { COMMAND_KEYS, fetchWorkflowDetail, useWorkflowDetail } from "../api";
import { reconcileMap } from "../lib/input-map";
import type { CommandFormValues } from "../lib/schemas";

export type WorkflowNotice = { dropped: string[]; autoMapped: string[] };
/** Workflow không khai báo output field → mặc định `text` (khoá đầu ra phổ biến của Dify) để form hợp lệ. */
export const DEFAULT_OUTPUT_FIELD = "text";
const NO_NOTICE: WorkflowNotice = { dropped: [], autoMapped: [] };

function applyWorkflow(
  form: UseFormReturn<CommandFormValues>,
  wf: Workflow,
  opts: { autofillOutput: boolean },
): WorkflowNotice {
  const { map, dropped, autoMapped } = reconcileMap(
    form.getValues("input_map"),
    wf.input_schema,
    form.getValues("args"),
  );
  form.setValue("input_map", map, { shouldDirty: opts.autofillOutput });
  if (opts.autofillOutput) {
    form.setValue("output_field", wf.output_field ?? DEFAULT_OUTPUT_FIELD, { shouldDirty: true });
  }
  return { dropped, autoMapped };
}

/** `changeWorkflow` = người dùng chọn workflow khác (có thông báo map bị bỏ); lần nạp đầu chỉ bảo đảm đủ mục map. */
export function useWorkflowLink(form: UseFormReturn<CommandFormValues>, fillOutputOnLoad: boolean) {
  const qc = useQueryClient();
  const workflowId = useWatch({ control: form.control, name: "workflow_id" });
  const detail = useWorkflowDetail(workflowId || undefined);
  const [notice, setNotice] = useState<WorkflowNotice>(NO_NOTICE);
  const initialised = useRef<string | null>(null);

  useEffect(() => {
    const wf = detail.data;
    if (!wf || initialised.current === wf.id) return;
    initialised.current = wf.id;
    const empty = form.getValues("output_field") === "";
    applyWorkflow(form, wf, { autofillOutput: fillOutputOnLoad && empty });
    // Bảo đảm nạp lần đầu (sửa/nhân bản) không làm form "chưa lưu".
    if (!fillOutputOnLoad) form.reset(form.getValues(), { keepFieldsRef: true });
  }, [detail.data, form, fillOutputOnLoad]);

  const changeWorkflow = useCallback(
    async (id: string) => {
      form.setValue("workflow_id", id, { shouldDirty: true, shouldValidate: true });
      const wf = await qc.fetchQuery({
        queryKey: COMMAND_KEYS.workflow(id),
        queryFn: () => fetchWorkflowDetail(id),
        staleTime: 30_000,
      });
      initialised.current = wf.id;
      setNotice(
        applyWorkflow(form, wf, {
          autofillOutput: !form.getFieldState("output_field", form.formState).isDirty,
        }),
      );
    },
    [qc, form],
  );

  return { workflow: detail.data, notice, changeWorkflow };
}
