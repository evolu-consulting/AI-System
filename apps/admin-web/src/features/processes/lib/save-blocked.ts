// CR-122 · lỗi chặn Lưu phải nói ra (không im lặng): chọn lỗi ĐẦU TIÊN theo thứ tự bước ⇒ toast "bước «X»: <câu sửa>".
// Hàm thuần: không React, không API.
import type { DraftErrors, StageDraft } from "./draft-types";

export type BlockedInfo = { stepName: string | null; reasonKey: string };

const stageIndex = (path: string): number | null => {
  const m = /^stages\.(\d+)(\.|$)/.exec(path);
  return m ? Number(m[1]) : null;
};

/** Không có lỗi ⇒ null. Có ⇒ lỗi của bước đứng trước nhất (lỗi chung của def sau cùng); tên bước rỗng ⇒ "Bước n". */
export function blockedInfo(
  errors: DraftErrors,
  stages: readonly Pick<StageDraft, "name">[],
): BlockedInfo | null {
  const entries = Object.entries(errors).filter(([, v]) => typeof v === "string" && v !== "");
  if (entries.length === 0) return null;
  let best: { idx: number; key: string } | null = null;
  for (const [path, key] of entries) {
    const idx = stageIndex(path);
    if (idx !== null && (best === null || idx < best.idx)) best = { idx, key };
  }
  if (best) {
    const name = stages[best.idx]?.name?.trim();
    return { stepName: name || String(best.idx + 1), reasonKey: best.key };
  }
  return { stepName: null, reasonKey: entries[0]?.[1] as string };
}
