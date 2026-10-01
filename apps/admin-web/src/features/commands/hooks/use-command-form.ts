// ADM-FR-20, ADM-FR-22 · AC-A03 · form editor Command: dựng giá trị ban đầu (mới / sửa / nhân bản), lưu (POST/PATCH kèm version),
// chặn gửi khi thiếu input bắt buộc, ánh xạ lỗi server vào đúng chỗ.
import type { Command, Workflow } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { COMMAND_KEYS, useCreateCommand, useFeatureOptions, useUpdateCommand } from "../api";
import { emptyCommandForm, toDuplicateValues, toFormValues, toRequestBody } from "../lib/defaults";
import { validateInputMap } from "../lib/input-map";
import { type CommandFormValues, commandSchema } from "../lib/schemas";

export type MapIssues = { missing: string[]; unknown: string[]; unknownArgs: string[] };
export type ServerState = {
  name?: string;
  alias?: string;
  feature?: string;
  workflowDisabled?: boolean;
  map?: MapIssues;
};

type Source = { command?: Command; copyOf?: Command; presetWorkflow?: string };

function initialValues({ command, copyOf, presetWorkflow }: Source): CommandFormValues {
  if (command) return toFormValues(command);
  if (copyOf) return toDuplicateValues(copyOf);
  return { ...emptyCommandForm(), workflow_id: presetWorkflow ?? "" };
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Lỗi server có chỗ hiển thị riêng → phần cập nhật `ServerState`; `null` = để toast chung. */
export function serverPatch(
  err: ApiError,
  tr: ReturnType<typeof useTr>,
  name: string,
): ServerState | null {
  const d = (err.details ?? {}) as Record<string, unknown>;
  switch (err.code) {
    case "COMMAND_NAME_TAKEN": {
      const taken = typeof d.name === "string" ? d.name : "";
      const text = tr("commands.error.nameTaken", { name: taken });
      return taken === name ? { name: text } : { alias: text };
    }
    case "COMMAND_NEEDS_FEATURE":
      return { feature: tr("commands.error.featureRequired") };
    case "WORKFLOW_DISABLED":
      return { workflowDisabled: true };
    case "INPUT_MAP_INVALID":
      return {
        map: {
          missing: stringList(d.missing),
          unknown: stringList(d.unknown),
          unknownArgs: stringList(d.unknown_args),
        },
      };
    default:
      return null;
  }
}

export function useCommandForm(source: Source) {
  const { t } = useTranslation();
  const tr = useTr();
  const router = useRouter();
  const qc = useQueryClient();
  const create = useCreateCommand();
  const update = useUpdateCommand();
  const features = useFeatureOptions();
  const form = useForm<CommandFormValues>({
    resolver: zodResolver(commandSchema as never) as unknown as Resolver<CommandFormValues>,
    mode: "onTouched",
    defaultValues: initialValues(source),
  });
  const [server, setServer] = useState<ServerState>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  const isDirty = form.formState.isDirty;
  const isNew = !source.command;

  // Mặc định feature `core` cho command mới (D6: bản nhân bản giữ feature của bản gốc).
  useEffect(() => {
    const core = features.data?.find((f) => f.isCore);
    if (isNew && !source.copyOf && core && form.getValues("feature_ids").length === 0) {
      form.reset({ ...form.getValues(), feature_ids: [core.id] });
    }
  }, [features.data, isNew, source.copyOf, form]);

  // Tạo xong: chờ cờ "chưa lưu" tắt (UnsavedGuard) rồi mới chuyển sang trang sửa.
  useEffect(() => {
    if (createdId && !isDirty) {
      void router.navigate({
        to: "/commands/$commandId",
        params: { commandId: createdId },
        replace: true,
      });
    }
  }, [createdId, isDirty, router]);

  const fail = (err: unknown, values: CommandFormValues) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
    const patch = err instanceof ApiError ? serverPatch(err, tr, values.name) : null;
    if (patch) return setServer(patch);
    if (err instanceof ApiError && err.code === "INVALID_REFERENCE") {
      void qc.invalidateQueries({ queryKey: COMMAND_KEYS.all });
      return notifyError(t("errors.invalidReference"));
    }
    const spec = describeError(err);
    const reload = {
      label: t("common.reload"),
      onClick: () => void qc.invalidateQueries({ queryKey: COMMAND_KEYS.all }),
    };
    notifyError(
      tr(spec.key, spec.params),
      err instanceof ApiError && err.code === "VERSION_CONFLICT" ? reload : undefined,
    );
  };

  const save = async (values: CommandFormValues, workflow: Workflow | undefined) => {
    setServer({});
    const check = workflow
      ? validateInputMap(workflow.input_schema, values.args, values.input_map)
      : { missing: [], unknownArgs: [], warnings: [] };
    if (check.missing.length > 0 || check.unknownArgs.length > 0) {
      return setServer({
        map: { missing: check.missing, unknown: [], unknownArgs: check.unknownArgs },
      });
    }
    try {
      const body = toRequestBody(values);
      if (source.command) {
        const res = await update.mutateAsync({
          id: source.command.id,
          version: source.command.version,
          ...body,
        });
        notifySuccess(t("commands.toast.saved", { name: res.name }));
        return;
      }
      const res = await create.mutateAsync(body);
      notifySuccess(t("commands.toast.saved", { name: res.name }));
      form.reset(values);
      setCreatedId(res.id);
    } catch (err) {
      fail(err, values);
    }
  };

  return { form, server, save, pending: create.isPending || update.isPending };
}
