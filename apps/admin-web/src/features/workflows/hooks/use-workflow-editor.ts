// ADM-FR-10, ADM-FR-14, ADM-FR-22 · form editor Workflow: lưu (POST/PATCH kèm version) và ánh xạ lỗi server vào đúng chỗ.
import type { SchemaBreaksCommandsDetails, Workflow } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useCreateWorkflow, useUpdateWorkflow, WORKFLOW_KEYS } from "../api";
import type { BlockedInfo } from "../components/WorkflowBlockedDialog";
import {
  emptyWorkflowForm,
  toFormValues,
  toRequestBody,
  type WorkflowFormValues,
  workflowSchema,
} from "../lib/schemas";

export function useWorkflowEditor(workflow: Workflow | undefined) {
  const { t } = useTranslation();
  const tr = useTr();
  const router = useRouter();
  const qc = useQueryClient();
  const create = useCreateWorkflow();
  const update = useUpdateWorkflow();
  const form = useForm<WorkflowFormValues>({
    resolver: zodResolver(workflowSchema),
    mode: "onTouched",
    defaultValues: workflow ? toFormValues(workflow) : emptyWorkflowForm(),
  });
  const [breaks, setBreaks] = useState<SchemaBreaksCommandsDetails | null>(null);
  const [blocked, setBlocked] = useState<BlockedInfo | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const isDirty = form.formState.isDirty;

  // Tạo xong: chờ cờ "chưa lưu" tắt (UnsavedGuard đọc `dirty` ở lần render kế) rồi mới chuyển sang trang sửa.
  useEffect(() => {
    if (createdId && !isDirty) {
      void router.navigate({
        to: "/workflows/$workflowId",
        params: { workflowId: createdId },
        replace: true,
      });
    }
  }, [createdId, isDirty, router]);

  /** Lỗi có chỗ hiển thị riêng (ô Key, Alert, dialog chặn); `false` = chưa xử lý. */
  const failInline = (err: ApiError, values: WorkflowFormValues): boolean => {
    if (err.code === "KEY_TAKEN") {
      form.setError("key", { message: "workflows.error.keyTaken" }, { shouldFocus: true });
    } else if (err.code === "SCHEMA_BREAKS_COMMANDS") {
      setBreaks(err.details as SchemaBreaksCommandsDetails);
    } else if (err.code === "WORKFLOW_IN_USE") {
      const d = (err.details ?? {}) as Partial<BlockedInfo>;
      form.setValue("enabled", true, { shouldDirty: false });
      setBlocked({
        action: "disable",
        workflowKey: values.key,
        commands: d.commands ?? [],
        agents: d.agents ?? [],
      });
    } else return false;
    return true;
  };

  const fail = (err: unknown, values: WorkflowFormValues) => {
    if (!(err instanceof ApiError)) return notifyError(tr("toast.saveFailed", { reason: "" }));
    if (err.code === "UNAUTHORIZED" || failInline(err, values)) return;
    if (err.code === "INVALID_REFERENCE") {
      void qc.invalidateQueries({ queryKey: WORKFLOW_KEYS.secrets });
      return notifyError(t("errors.invalidReference"));
    }
    const spec = describeError(err);
    const reload = {
      label: t("common.reload"),
      onClick: () => void qc.invalidateQueries({ queryKey: WORKFLOW_KEYS.all }),
    };
    notifyError(tr(spec.key, spec.params), err.code === "VERSION_CONFLICT" ? reload : undefined);
  };

  const submit = form.handleSubmit(async (values) => {
    setBreaks(null);
    try {
      if (!workflow) {
        const body = { key: values.key.trim().toLowerCase(), ...toRequestBody(values) };
        const res = await create.mutateAsync(body);
        notifySuccess(t("workflows.toast.saved", { name: res.key }));
        form.reset(values); // bỏ cờ "chưa lưu" trước khi rời trang
        setCreatedId(res.id);
        return;
      }
      const res = await update.mutateAsync({
        id: workflow.id,
        version: workflow.version,
        ...toRequestBody(values),
      });
      notifySuccess(t("workflows.toast.saved", { name: res.key }));
    } catch (err) {
      fail(err, values);
    }
  });

  return {
    form,
    submit,
    pending: create.isPending || update.isPending,
    breaks,
    blocked,
    closeBlocked: () => setBlocked(null),
  };
}
