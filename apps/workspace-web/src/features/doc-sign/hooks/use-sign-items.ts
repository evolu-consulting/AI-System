// CR-181 · trạng thái mục theo tệp. Mỗi thao tác tính lại `parts` bằng partsOf (lib/sign-items) rồi báo `onChange`.

import type { SignerKindApi, SignSide } from "@ai/contracts/pack-contracts";
import { SIGN_INITIALS_SCALE } from "@ai/contracts/pack-contracts";
import { useCallback, useRef } from "react";
import type { Rect, StagePage } from "../lib/geometry";
import { rectFromParts } from "../lib/geometry";
import { signField } from "../lib/session-map";
import {
  copyAll,
  moveItem,
  type NewItem,
  placeItem,
  removeItem,
  type SignItem,
  setSide,
} from "../lib/sign-items";

export type ItemsByFile = Record<string, SignItem[]>;

/**
 * Thao tác thuần: tính mục mới từ bản MỚI NHẤT (`ref.current`), ghi lại vào ref rồi báo `onChange`.
 * Không đặt tác dụng phụ trong hàm cập nhật state (lỗi cũ: `onChange` chạy trong updater ⇒ chủ sở hữu thấy danh sách rỗng khi Lưu).
 */
export function applyOp(
  ref: { current: ItemsByFile },
  onChange: (fileId: string, items: SignItem[]) => void,
  fileId: string,
  fn: (items: SignItem[]) => SignItem[] | null,
): void {
  const prev = ref.current[fileId] ?? [];
  const next = fn(prev);
  if (!next || next === prev) return;
  ref.current = { ...ref.current, [fileId]: next };
  onChange(fileId, next);
}

/** Điều khiển từ ngoài: `items` do chủ màn giữ, mỗi thao tác báo `onChange(fileId, items)`. */
export function useSignItems(
  items: ItemsByFile,
  onChange: (fileId: string, items: SignItem[]) => void,
) {
  const byFile = items;
  const ref = useRef(items);
  ref.current = items;
  const apply = useCallback(
    (fileId: string, fn: (items: SignItem[]) => SignItem[] | null) =>
      applyOp(ref, onChange, fileId, fn),
    [onChange],
  );
  return {
    byFile,
    add: (f: string, spec: NewItem, rect: Rect, pages: StagePage[]) =>
      apply(f, (i) => placeItem(i, spec, rect, pages)),
    move: (f: string, id: string, rect: Rect, pages: StagePage[]) =>
      apply(f, (i) => moveItem(i, id, rect, pages)),
    append: (f: string, add: SignItem[]) =>
      apply(f, (i) => [
        ...i.filter(
          (x) =>
            !add.some((a) => a.kind === x.kind && a.side === x.side && x.status === "editable"),
        ),
        ...add,
      ]),
    fill: (f: string, id: string, imageUrl: string) => apply(f, (i) => signField(i, id, imageUrl)),
    remove: (f: string, id: string) => apply(f, (i) => removeItem(i, id)),
    changeSide: (
      f: string,
      id: string,
      side: SignSide,
      person?: string,
      signer?: { kind: SignerKindApi; ref: string },
    ) => apply(f, (i) => setSide(i, id, side, person, signer)),
    copyToAll: (f: string, id: string, pages: StagePage[]) =>
      apply(f, (i) =>
        copyAll(i, id, pages, (it) => rectFromParts(it.parts, pages), SIGN_INITIALS_SCALE),
      ),
  };
}
