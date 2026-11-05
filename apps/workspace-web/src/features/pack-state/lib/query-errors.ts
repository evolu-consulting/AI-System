// PK-FR-05 · PK-FR-10 · TF4 · lỗi chung của mọi lời gọi gói (gắn vào QueryCache/MutationCache ở `app/query-client.ts`):
// 403 `PACK_FORBIDDEN`/`PACK_DISABLED` ⇒ nạp lại `/me` để khung chuyển sang trang trạng thái; 409 ⇒ toast "vừa được cập nhật".
import type { QueryClient } from "@tanstack/react-query";
import { errorKind, ME_QUERY_KEY } from "./pack-state";

export type ErrorEffects = {
  /** Toast lỗi ngắn (key i18n đã dịch ở nơi gắn). */
  conflict: () => void;
};

export function handlePackError(err: unknown, qc: QueryClient, fx: ErrorEffects): void {
  const kind = errorKind(err);
  if (kind === "forbidden" || kind === "disabled") {
    void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
  } else if (kind === "conflict") {
    fx.conflict();
  }
}
