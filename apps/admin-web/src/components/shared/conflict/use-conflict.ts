// ADM-FR-55 · M3-R20 · hook của ConflictDialog (≤ 50 dòng): `capture(err, mineVersion)` mở hộp khi là VERSION_CONFLICT.
// Feature cấp `buildRows` (diff payload), `submit(version)` (gửi lại cùng body), `onReload(current)` (dựng lại form).
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { type ConflictCurrent, type ConflictInfo, parseConflict } from "@/lib/conflict";
import type { DiffResult } from "@/lib/diff-fields";
import type { ConflictDialogProps, ConflictEntity } from "./ConflictDialog";

export type UseConflictConfig = {
  entity: ConflictEntity;
  buildRows: (current: ConflictCurrent) => DiffResult;
  submit: (version: number) => Promise<unknown>;
  onReload: (current: ConflictCurrent) => void;
  /** Lỗi không phải xung đột khi `Ghi đè` (hộp thoại đóng, nơi gọi báo lỗi). */
  onError?: (err: unknown) => void;
};
type State = { info: ConflictInfo; mine: number; diff: DiffResult };

export function useConflict(cfg: UseConflictConfig) {
  const { t } = useTranslation();
  const [state, setState] = useState<State | null>(null);
  const ref = useRef(cfg);
  ref.current = cfg;
  const capture = useCallback((err: unknown, mineVersion: number): boolean => {
    const info = parseConflict(err);
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
      if (capture(err, latest)) return;
      setState(null);
      ref.current.onError?.(err);
    }
  }, [state, capture]);
  const reload = useCallback(() => {
    if (!state) return;
    ref.current.onReload(state.info.current);
    notifySuccess(t("conflict.toast.loaded", { n: state.info.current.version }));
    setState(null);
  }, [state, t]);
  const props: ConflictDialogProps | null = state && {
    entity: cfg.entity,
    mineVersion: state.mine,
    latestVersion: state.info.current.version,
    updatedAt: state.info.updatedAt,
    updatedBy: state.info.updatedBy,
    rows: state.diff.rows,
    more: state.diff.more,
    onOverwrite: overwrite,
    onReload: reload,
  };
  return { props, capture };
}
