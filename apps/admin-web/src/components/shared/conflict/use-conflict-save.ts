// ADM-FR-55 · M3-R20 · lưu có `version` + xử lý 409: `save(body, version)` gửi PATCH, nếu xung đột mở ConflictDialog.
// `Ghi đè` gửi lại CÙNG body với `version` mới nhất (plan-frontend D5). Mặc định so `body` với đúng các khoá đó của bản mới.
import { useRef } from "react";
import { type ConflictCurrent, pickKeys } from "@/lib/conflict";
import { diffFields } from "@/lib/diff-fields";
import type { ConflictEntity } from "./ConflictDialog";
import { useConflict } from "./use-conflict";

export type ConflictSaveConfig<B extends object> = {
  entity: ConflictEntity;
  mutate: (body: B & { version: number }) => Promise<unknown>;
  onSaved: () => void;
  onFail: (err: unknown) => void;
  onReload: (current: ConflictCurrent) => void;
  /** Dạng so sánh của bản mới; mặc định chọn các khoá của body từ `current`. */
  toComparable?: (current: ConflictCurrent, body: B) => unknown;
};

export function useConflictSave<B extends object>(cfg: ConflictSaveConfig<B>) {
  const last = useRef<B | null>(null);
  const conflict = useConflict({
    entity: cfg.entity,
    buildRows: (cur) => {
      const body = last.current ?? ({} as B);
      const latest = cfg.toComparable
        ? cfg.toComparable(cur, body)
        : pickKeys(cur, Object.keys(body));
      return diffFields(body, latest);
    },
    submit: async (version) => {
      if (!last.current) return;
      await cfg.mutate({ ...last.current, version });
      cfg.onSaved();
    },
    onReload: cfg.onReload,
    onError: cfg.onFail,
  });
  const save = async (body: B, version: number) => {
    last.current = body;
    try {
      await cfg.mutate({ ...body, version });
      cfg.onSaved();
    } catch (err) {
      if (!conflict.capture(err, version)) cfg.onFail(err);
    }
  };
  return { save, props: conflict.props };
}
