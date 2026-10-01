// ADM-FR-55 · M3-R20 · lưu có `version` + xử lý 409: `save(body, version)` gửi PATCH, nếu xung đột mở ConflictDialog.
// `Ghi đè` gửi lại CÙNG body với `version` mới nhất (plan-frontend D5). Mặc định so `body` với đúng các khoá đó của bản mới.
import { useRef } from "react";
import { type ConflictCurrent, pickKeys } from "@/lib/conflict";
import { diffFields } from "@/lib/diff-fields";
import type { ConflictEntity } from "./ConflictDialog";
import { useConflict } from "./use-conflict";

export type ConflictSaveConfig<B extends object, R> = {
  entity: ConflictEntity;
  mutate: (body: B & { version: number }) => Promise<R>;
  /** Gọi với phản hồi của lần lưu thành công (kể cả sau `Ghi đè`). */
  onSaved: (res: R) => void;
  onFail: (err: unknown) => void;
  onReload: (current: ConflictCurrent) => void;
  /** Dạng so sánh của bản mới; mặc định chọn các khoá của body từ `current`. */
  toComparable?: (current: ConflictCurrent, body: B) => unknown;
};

export function useConflictSave<B extends object, R = unknown>(cfg: ConflictSaveConfig<B, R>) {
  const last = useRef<B | null>(null);
  const shown = useRef<object | null>(null);
  const conflict = useConflict({
    entity: cfg.entity,
    buildRows: (cur) => {
      const body = shown.current ?? last.current ?? ({} as B);
      const latest = cfg.toComparable
        ? cfg.toComparable(cur, body as B)
        : pickKeys(cur, Object.keys(body));
      return diffFields(body, latest);
    },
    submit: async (version) => {
      if (!last.current) return;
      cfg.onSaved(await cfg.mutate({ ...last.current, version }));
    },
    onReload: cfg.onReload,
    onError: cfg.onFail,
  });
  /** `conflict` = đã mở ConflictDialog; `failed` = lỗi khác (đã gọi `onFail`). */
  /** `forDiff`: dạng đầy đủ của bản của bạn để hiện khác biệt khi body gửi đi chỉ gồm phần đã sửa. */
  const save = async (
    body: B,
    version: number,
    forDiff?: B,
  ): Promise<"saved" | "conflict" | "failed"> => {
    last.current = body;
    shown.current = forDiff ?? null;
    try {
      cfg.onSaved(await cfg.mutate({ ...body, version }));
      return "saved";
    } catch (err) {
      if (conflict.capture(err, version)) return "conflict";
      cfg.onFail(err);
      return "failed";
    }
  };
  return { save, props: conflict.props };
}
