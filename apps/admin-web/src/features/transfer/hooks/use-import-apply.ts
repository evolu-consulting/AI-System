// ADM-FR-54 · ADM-BR-04 · M4-R15 · bước 3 của Import: giá trị secret còn thiếu (chỉ state, D11) → xác nhận → áp dụng.
// 409 (cấu hình đổi sau xem trước) → đóng hộp thoại, chạy lại dry-run, báo `transfer.import.stale` (plan-frontend §8).
import { type ImportRequest, SecretValueSchema } from "@ai/contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError, type MessageSpec } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useImportCommit } from "../api";
import type { ImportFlow } from "./use-import-preview";

export const secretValueOk = (v: string | undefined) =>
  SecretValueSchema.safeParse(v ?? "").success;

function applyErrorSpec(e: unknown, missing: number): MessageSpec {
  if (e instanceof ApiError) {
    if (e.code === "SECRETS_REQUIRED") {
      return { key: "transfer.import.secretsMissing", params: { n: missing || 1 } };
    }
    if (e.code === "IMPORT_INVALID") return { key: "transfer.import.invalid" };
    if (e.code === "PAYLOAD_TOO_LARGE") return { key: "transfer.import.tooLarge" };
  }
  return describeError(e);
}

export function useImportApply(flow: ImportFlow) {
  const { t } = useTranslation();
  const commit = useImportCommit();
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const { file, preview, refresh, reset } = flow;

  // Đổi file / quay lại bước 1 → xoá giá trị secret khỏi bộ nhớ.
  useEffect(() => {
    if (file === null) setValues({});
  }, [file]);
  useEffect(() => () => setValues({}), []);

  const missing = preview?.missing_secrets ?? [];
  const missingCount = missing.filter((m) => !secretValueOk(values[m.name])).length;
  const changes = preview ? preview.summary.added + preview.summary.updated : 0;

  const setValue = useCallback((name: string, v: string) => {
    setValues((prev) => ({ ...prev, [name]: v }));
  }, []);

  const apply = useCallback(async () => {
    if (!file || !preview) return;
    const secrets = Object.fromEntries(missing.map((m) => [m.name, values[m.name] ?? ""]));
    const body: ImportRequest = {
      file_name: file.name,
      content: file.content,
      base_config_version: preview.base_config_version,
      ...(missing.length > 0 ? { secrets } : {}),
    };
    try {
      const r = await commit.mutateAsync(body);
      const { added: a, updated: u } = r.summary;
      notifySuccess(t("transfer.toast.imported", { a, u, n: r.config_version }));
      setValues({});
      reset();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        refresh();
        return;
      }
      const m = applyErrorSpec(e, missingCount);
      notifyError(t(m.key, m.params));
      throw e;
    }
  }, [commit, file, missing, missingCount, preview, refresh, reset, t, values]);

  return { values, setValue, missingCount, changes, confirming, setConfirming, apply };
}
