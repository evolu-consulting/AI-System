// ADM-FR-55 · CR-121 R4 · luật thuần cho lưu editor Feature: phản hồi PATCH về muộn / refetch cũ không được ghi đè nháp đang sửa.
import type { FeatureDetail } from "@ai/contracts/features";

/** Bỏ id trùng, giữ thứ tự xuất hiện đầu (không có hàng /command lặp). */
export const uniqueIds = (ids: readonly string[]): string[] => [...new Set(ids)];

export const sameIdSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Phản hồi lưu cũ hơn bản đã áp (về muộn, lượt lưu trước) ⇒ bỏ qua. */
export const isStaleSave = (applied: number, incoming: number) => incoming < applied;

/** Bản tải về cũ hơn bản đang giữ trong cache (refetch sau lưu lần trước về muộn) ⇒ giữ bản mới hơn. */
export function newerDetail(cached: FeatureDetail | undefined, fetched: FeatureDetail) {
  return cached && cached.version > fetched.version ? cached : fetched;
}

/**
 * Tập command sau khi nhận phản hồi lưu: người dùng đã sửa tiếp trong lúc chờ (`edited`) ⇒ giữ nháp của họ
 * (command_ids không phải field đăng ký nên `keepDirtyValues` của react-hook-form không giữ hộ); ngược lại lấy theo server.
 * `dirty` = nháp còn khác bản server ⇒ phải bật cờ dirty để thanh Lưu còn hiện.
 */
export function commandsAfterSave(
  serverIds: readonly string[],
  current: readonly string[],
  edited: boolean,
): { ids: string[]; dirty: boolean } {
  if (!edited) return { ids: uniqueIds(serverIds), dirty: false };
  const ids = uniqueIds(current);
  return { ids, dirty: !sameIdSet(ids, serverIds) };
}
