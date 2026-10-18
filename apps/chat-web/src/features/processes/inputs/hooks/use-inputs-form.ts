// HUB-FR-124 · AC-H37 · state + gửi của form `!key`: giữ giá trị khi lỗi, tải tệp, chọn nguồn điền sẵn nhánh.
import { PROCESS_RUNS_PER_TENANT } from "@ai/contracts/chat";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/lib/http";
import { useRunStarter } from "../../composer/hooks/use-bang-submit";
import { uploadInputFile, useSourceChips } from "../api";
import {
  emptyValues,
  type FieldError,
  type FieldValue,
  fieldErrors,
  gitChips,
  type InputValues,
  serverDateErrors,
  submitErrorKey,
  toRequestInputs,
} from "../lib/inputs-rules";

/** 400 `VALIDATION_ERROR` với issue path `inputs.<i>.value` trỏ tới trường `date` ⇒ khoá trường bị từ chối. */
function datedByServer(sent: Parameters<typeof serverDateErrors>[0], err: unknown): string[] {
  if (!(err instanceof ApiError) || err.code !== "VALIDATION_ERROR") return [];
  return serverDateErrors(sent, issuePaths(err.details));
}

/** `details.issues[].path` (mảng) → "a.b.c". */
function issuePaths(details: unknown): string[] {
  const raw = (details as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(raw)) return [];
  return raw.map((i: { path?: unknown }) => (Array.isArray(i.path) ? i.path.join(".") : ""));
}

import type { InputsRequest } from "../lib/inputs-store";

export function useInputsForm(req: InputsRequest) {
  const { t } = useTranslation();
  const defs = useMemo(() => req.item.inputs ?? [], [req.item]);
  const [values, setValues] = useState<InputValues>(() => emptyValues(defs));
  const [uploading, setUploading] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = useRunStarter(req.roomId, req.convId);
  const chips = useSourceChips(defs.some((d) => d.type === "source_ref"));
  const git = useMemo(() => gitChips(chips.data ?? []), [chips.data]);
  const [serverDate, setServerDate] = useState<string[]>([]);
  const errors = fieldErrors(defs, values);
  /** Lỗi hiển thị: luật client + `date` bị server từ chối (không chặn gửi lại sau khi sửa ô). */
  const shown: Record<string, FieldError> = { ...errors };
  for (const k of serverDate) shown[k] ??= "dateInvalid";

  const patch = useCallback((key: string, p: Partial<FieldValue>) => {
    setServerDate((s) => s.filter((k) => k !== key));
    setValues((v) => ({
      ...v,
      [key]: { ...(v[key] ?? { value: "", fileName: "", branch: "" }), ...p },
    }));
  }, []);

  /** Chọn nguồn ⇒ điền sẵn `default_branch` (sửa được); bỏ chọn ⇒ xoá nhánh. */
  const pickSource = useCallback(
    (key: string, sourceKey: string) => {
      const branch = git.find((c) => c.key === sourceKey)?.default_branch ?? "";
      patch(key, { value: sourceKey, branch });
    },
    [git, patch],
  );

  const pickFile = useCallback(
    async (key: string, file: File) => {
      setUploading(key);
      setFileError(null);
      try {
        const up = await uploadInputFile(file);
        patch(key, { value: up.id, fileName: up.name });
      } catch {
        setFileError(key);
      } finally {
        setUploading(null);
      }
    },
    [patch],
  );

  const submit = useCallback(async () => {
    if (pending || uploading || Object.keys(errors).length > 0) return;
    setPending(true);
    setError(null);
    try {
      const sent = toRequestInputs(defs, values);
      setServerDate([]);
      const r = await run(req.item.key, req.text, sent);
      if (r === true || (typeof r === "object" && r.ok)) return req.resolve(true);
      const code = typeof r === "object" && r.error instanceof ApiError ? r.error.code : "";
      const dated = typeof r === "object" ? datedByServer(sent, r.error) : [];
      if (dated.length > 0) return setServerDate(dated);
      const e = submitErrorKey(code, req.item.key, PROCESS_RUNS_PER_TENANT);
      setError(t(e.key, e.params));
    } finally {
      setPending(false);
    }
  }, [pending, uploading, errors, run, req, defs, values, t]);

  return {
    defs,
    values,
    errors: shown,
    blockingErrors: errors,
    error,
    pending,
    uploading,
    fileError,
    chips: {
      git,
      loading: chips.isLoading,
      failed: chips.isError,
      retry: () => void chips.refetch(),
    },
    patch,
    pickSource,
    pickFile,
    submit,
    cancel: () => req.resolve(false),
  };
}
