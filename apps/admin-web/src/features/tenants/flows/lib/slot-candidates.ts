// CR-105 · L3: ứng viên để gán cho một khe của tenant = quy trình thư viện ĐÃ XUẤT BẢN cùng khe (Hub 422 `PROCESS_NOT_PUBLISHED` nếu khác).
import type { LibraryListItem } from "@/features/processes/library-api";

export type SlotCandidate = { id: string; label: string };

export function slotCandidates(
  rows: readonly LibraryListItem[] | undefined,
  slot: string,
): SlotCandidate[] {
  return (rows ?? [])
    .filter((r) => r.slot === slot && r.published_version != null && r.enabled)
    .map((r) => ({ id: r.id, label: `${r.name} · v${r.published_version}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "vi"));
}
