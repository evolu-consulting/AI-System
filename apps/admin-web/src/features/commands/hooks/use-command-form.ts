// ADM-FR-20, ADM-FR-22 · AC-A03 · form editor Command: dựng giá trị ban đầu (mới / sửa / nhân bản), lưu (POST/PATCH kèm version),
// chặn gửi khi thiếu input bắt buộc, ánh xạ lỗi server vào đúng chỗ.
import type { Command, Workflow } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type Resolver, type UseFormReturn, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { COMMAND_KEYS, useCreateCommand, useFeatureOptions } from "../api";
import { emptyCommandForm, toDuplicateValues, toFormValues, toRequestBody } from "../lib/defaults";
import { validateInputMap } from "../lib/input-map";
import { type CommandFormValues, commandSchema } from "../lib/schemas";
import { useCommandConflict } from "./use-command-conflict";

export type MapIssues = { missing: string[]; unknown: string[]; unknownArgs: string[] };
export type ServerState = {
  name?: string;
  alias?: string;
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

type Form = UseFormReturn<CommandFormValues>;

/** Mặc định feature `core` cho command mới (D6: bản nhân bản giữ feature của bản gốc). */
function useDefaultCoreFeature(form: Form, applies: boolean) {
  const features = useFeatureOptions();
  useEffect(() => {
    const core = features.data?.find((f) => f.isCore);
    if (applies && core && form.getValues("feature_ids").length === 0) {
      // keepFieldsRef: reset thường xoá ref các ô đã đăng ký tới lần render sau ⇒ gõ vào "Tên command" đúng lúc đó bị mất (I1 X1).
      form.reset({ ...form.getValues(), feature_ids: [core.id] }, { keepFieldsRef: true });
    }
  }, [features.data, applies, form]);
}

/** Tạo xong: chờ cờ "chưa lưu" tắt (UnsavedGuard) rồi mới chuyển sang trang sửa. */
function useCreatedRedirect(createdId: string | null, isDirty: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (createdId && !isDirty) {
      void router.navigate({
        to: "/commands/$commandId",
        params: { commandId: createdId },
        replace: true,
      });
    }
  }, [createdId, isDirty, router]);
}

/** Lỗi lưu: lỗi có chỗ riêng → `setServer`; `INVALID_REFERENCE` → làm mới; còn lại toast bền (409 version → "Tải lại"). */
function useSaveFail(setServer: (s: ServerState) => void) {
  const { t } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  return (err: unknown, name: string) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
    const patch = err instanceof ApiError ? serverPatch(err, tr, name) : null;
    if (patch) return setServer(patch);
    const reset = () => void qc.invalidateQueries({ queryKey: COMMAND_KEYS.all });
    if (err instanceof ApiError && err.code === "INVALID_REFERENCE") {
      reset();
      return notifyError(t("errors.invalidReference"));
    }
    const spec = describeError(err);
    notifyError(tr(spec.key, spec.params));
  };
}

/** Chặn gửi khi thiếu input bắt buộc hoặc `arg` trỏ tham số chưa khai báo (AC-A03); `null` = hợp lệ. */
function mapBlock(values: CommandFormValues, workflow: Workflow | undefined): MapIssues | null {
  if (!workflow) return null;
  const check = validateInputMap(workflow.input_schema, values.args, values.input_map);
  if (check.missing.length === 0 && check.unknownArgs.length === 0) return null;
  return { missing: check.missing, unknown: [], unknownArgs: check.unknownArgs };
}

export function useCommandForm(source: Source) {
  const { t } = useTranslation();
  const create = useCreateCommand();
  const form = useForm<CommandFormValues>({
    resolver: zodResolver(commandSchema as never) as unknown as Resolver<CommandFormValues>,
    mode: "onTouched",
    defaultValues: initialValues(source),
  });
  const [server, setServer] = useState<ServerState>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  useDefaultCoreFeature(form, !source.command && !source.copyOf);
  useCreatedRedirect(createdId, form.formState.isDirty);
  const fail = useSaveFail(setServer);
  const cc = useCommandConflict(source.command, form, fail);

  const save = async (values: CommandFormValues, workflow: Workflow | undefined) => {
    setServer({});
    const blocked = mapBlock(values, workflow);
    if (blocked) return setServer({ map: blocked });
    if (source.command) return cc.save(values);
    try {
      const res = await create.mutateAsync(toRequestBody(values));
      notifySuccess(t("commands.toast.saved", { name: res.name }));
      form.reset(values);
      setCreatedId(res.id);
    } catch (err) {
      fail(err, values.name);
    }
  };

  return { form, server, save, pending: create.isPending || cc.pending, conflict: cc.props };
}
