// ADM-FR-54 · M4-R14 · bước 1–2 của Import: kiểm file ở client → đọc nội dung (chỉ trong bộ nhớ, D11) → dry-run.
import type { ImportError, ImportPreview } from "@ai/contracts";
import { useCallback, useState } from "react";
import { ApiError } from "@/lib/http";
import { useImportDryRun } from "../api";
import { checkImportFile, type ImportFileProblem } from "../lib/import-file";

export type LoadedFile = { name: string; size: number; content: string };

/** Danh sách lỗi file: từ 400 `IMPORT_INVALID {errors}` (dry-run thường trả 200 `valid: false`). */
function invalidErrors(err: unknown): ImportError[] | null {
  if (!(err instanceof ApiError) || err.code !== "IMPORT_INVALID") return null;
  const list = (err.details as { errors?: unknown } | null | undefined)?.errors;
  return Array.isArray(list) ? (list as ImportError[]) : [];
}

/** Kết quả dry-run → nhánh hiển thị: quá lớn (413) · lỗi file · lỗi khác (ErrorState) · bản xem trước. */
function outcome(data: ImportPreview | undefined, error: unknown) {
  const tooLarge = error instanceof ApiError && error.code === "PAYLOAD_TOO_LARGE";
  const preview = data ?? null;
  const errors = preview && !preview.valid ? preview.errors : invalidErrors(error);
  const failed = error && !tooLarge && errors === null ? error : null;
  return { preview, errors, tooLarge, failed };
}

export function useImportPreview() {
  const { mutate, reset: resetDry, data, error, isPending } = useImportDryRun();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [problem, setProblem] = useState<ImportFileProblem | null>(null);
  const [stale, setStale] = useState(false);

  const run = useCallback(
    (f: LoadedFile) => mutate({ file_name: f.name, content: f.content }),
    [mutate],
  );
  const pick = useCallback(
    async (f: File) => {
      const p = checkImportFile(f);
      setProblem(p);
      if (p) return;
      const loaded = { name: f.name, size: f.size, content: await f.text() };
      setStale(false);
      resetDry();
      setFile(loaded);
      run(loaded);
    },
    [resetDry, run],
  );
  /** Sau 409 khi áp dụng: chạy lại dry-run trên cùng nội dung và báo `transfer.import.stale`. */
  const refresh = useCallback(() => {
    if (!file) return;
    setStale(true);
    run(file);
  }, [file, run]);
  const retry = useCallback(() => file && run(file), [file, run]);
  const reset = useCallback(() => {
    setFile(null);
    setProblem(null);
    setStale(false);
    resetDry();
  }, [resetDry]);

  return {
    file,
    problem,
    stale,
    pending: isPending,
    ...outcome(data, error),
    pick,
    refresh,
    retry,
    reset,
  };
}

export type ImportFlow = ReturnType<typeof useImportPreview>;
