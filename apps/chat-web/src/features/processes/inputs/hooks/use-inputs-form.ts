// HUB-FR-124 · AC-H37 · state + gửi của form `!key`: giữ giá trị khi lỗi, tải tệp, chọn nguồn điền sẵn nhánh.
import { PROCESS_RUNS_PER_TENANT } from "@ai/contracts/chat";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/lib/http";
import { useRunStarter } from "../../composer/hooks/use-bang-submit";
import { uploadInputFile, useSourceChips } from "../api";
import {
  emptyValues,
  type FieldValue,
  fieldErrors,
  gitChips,
  type InputValues,
  submitErrorKey,
  toRequestInputs,
} from "../lib/inputs-rules";
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
  const errors = fieldErrors(defs, values);

  const patch = useCallback((key: string, p: Partial<FieldValue>) => {
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
      const r = await run(req.item.key, req.text, toRequestInputs(defs, values));
      if (r === true || (typeof r === "object" && r.ok)) return req.resolve(true);
      const code = typeof r === "object" && r.error instanceof ApiError ? r.error.code : "";
      const e = submitErrorKey(code, req.item.key, PROCESS_RUNS_PER_TENANT);
      setError(t(e.key, e.params));
    } finally {
      setPending(false);
    }
  }, [pending, uploading, errors, run, req, defs, values, t]);

  return {
    defs,
    values,
    errors,
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
