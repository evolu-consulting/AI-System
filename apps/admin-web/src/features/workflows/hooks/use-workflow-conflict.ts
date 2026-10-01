// ADM-FR-55 · M3-R20 · TECH-DEBT #14 · lưu editor Workflow (PATCH kèm version), 409 → ConflictDialog (câu có {user}, A4).
// Version cho lần lưu kế tiếp lấy từ phản hồi lưu (không đợi refetch, không dựng lại form bằng `key`): form chỉ `reset`
// khi lưu xong (giữ phần vừa gõ thêm) hoặc khi `Tải bản mới`.
import type { Workflow } from "@ai/contracts";
import { useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifySuccess } from "@/components/shared/toast";
import { useEditCounter } from "@/lib/use-edit-counter";
import { useUpdateWorkflow } from "../api";
import { toFormValues, toRequestBody, type WorkflowFormValues } from "../lib/schemas";

type Body = ReturnType<typeof toRequestBody>;
const asWorkflow = (cur: unknown) => cur as Workflow;

export function useWorkflowConflict(
  workflow: Workflow | undefined,
  form: UseFormReturn<WorkflowFormValues>,
  fail: (err: unknown, key: string) => void,
) {
  const { t } = useTranslation();
  const update = useUpdateWorkflow();
  const version = useRef(workflow?.version ?? 0);
  const edits = useEditCounter(form);
  const atSubmit = useRef(0);
  const conflict = useConflictSave<Body, Workflow>({
    entity: "workflow",
    mutate: (body) => update.mutateAsync({ id: workflow?.id ?? "", ...body }),
    onSaved: (res) => {
      version.current = res.version;
      form.reset(toFormValues(res), { keepDirtyValues: edits.current !== atSubmit.current });
      notifySuccess(t("workflows.toast.saved", { name: res.key }));
    },
    onFail: (err) => fail(err, workflow?.key ?? ""),
    onReload: (cur) => {
      version.current = cur.version;
      form.reset(toFormValues(asWorkflow(cur)));
    },
    toComparable: (cur) => toRequestBody(toFormValues(asWorkflow(cur))),
  });
  const save = (values: WorkflowFormValues) => {
    atSubmit.current = edits.current;
    return conflict.save(toRequestBody(values), version.current);
  };
  return { save, props: conflict.props, pending: update.isPending };
}
