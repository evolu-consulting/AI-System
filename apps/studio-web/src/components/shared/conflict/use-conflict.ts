// HUB-FR-69 · hook của ConflictDialog: `capture(err, mineVersion)` mở hộp khi là VERSION_CONFLICT.
// Feature cấp `buildRows(current)` (diff), `submit(version)` (gửi lại bản nháp với version mới nhất), `onReload(current)`.
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type ConflictInfo, parseConflict } from "#/lib/conflict";
import type { ConflictDialogProps } from "./ConflictDialog";
import type { DiffResult } from "./types";

export type UseConflictConfig<T extends { version: number }> = {
  buildRows: (current: T) => DiffResult;
  submit: (version: number) => Promise<unknown>;
  onReload: (current: T) => void;
  /** Lỗi không phải xung đột khi [Ghi đè] (hộp đóng, nơi gọi báo lỗi). */
  onError?: (err: unknown) => void;
};
type State<T extends { version: number }> = {
  info: ConflictInfo<T>;
  mine: number;
  diff: DiffResult;
};

export function useConflict<T extends { version: number }>(cfg: UseConflictConfig<T>) {
  const { t } = useTranslation();
  const [state, setState] = useState<State<T> | null>(null);
  const ref = useRef(cfg);
  ref.current = cfg;
  const capture = useCallback((err: unknown, mineVersion: number): boolean => {
    const info = parseConflict<T>(err);
    if (info) setState({ info, mine: mineVersion, diff: ref.current.buildRows(info.current) });
    return info !== null;
  }, []);
  const overwrite = useCallback(async () => {
    if (!state) return;
    const latest = state.info.current.version;
    try {
      await ref.current.submit(latest);
      setState(null);
    } catch (err) {
      if (capture(err, latest)) return; // lại 409 → mở lại hộp với bản mới hơn
      setState(null);
      ref.current.onError?.(err);
    }
  }, [state, capture]);
  const reload = useCallback(() => {
    if (!state) return;
    ref.current.onReload(state.info.current);
    toast.success(t("conflict.toast.loaded", { n: state.info.current.version }));
    setState(null);
  }, [state, t]);
  const props: ConflictDialogProps | null = state && {
    mineVersion: state.mine,
    latestVersion: state.info.current.version,
    updatedAt: state.info.updatedAt,
    rows: state.diff.rows,
    more: state.diff.more,
    onOverwrite: overwrite,
    onReload: reload,
  };
  return { props, capture };
}
