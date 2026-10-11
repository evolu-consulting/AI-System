// HUB-FR-124 · AC-H37 · yêu cầu mở form `!key` (module store): `intercept` mở form và chờ kết quả, host (AppShell) vẽ form.
import { useSyncExternalStore } from "react";
import type { CatalogItem } from "../../composer/api";

export type InputsRequest = {
  item: CatalogItem;
  /** Chữ người dùng đã gõ sau `!key` — giữ làm `input`. */
  text: string;
  roomId: string | null;
  convId: string | null;
  /** `true` = đã bắt đầu quy trình (composer xoá chữ); `false` = đóng form (composer giữ chữ). */
  resolve(ok: boolean): void;
};

let current: InputsRequest | null = null;
const subs = new Set<() => void>();
const emit = () => {
  for (const fn of subs) fn();
};

/** Mở form; request đang mở (nếu có) bị đóng với `false`. */
export function openInputsForm(req: Omit<InputsRequest, "resolve">): Promise<boolean> {
  current?.resolve(false);
  return new Promise<boolean>((done) => {
    const self: InputsRequest = {
      ...req,
      resolve: (ok) => {
        if (current === self) {
          current = null;
          emit();
        }
        done(ok);
      },
    };
    current = self;
    emit();
  });
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useInputsRequest = (): InputsRequest | null =>
  useSyncExternalStore(subscribe, () => current);
