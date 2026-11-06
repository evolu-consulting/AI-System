// CR-121 c12 · R3 · Công ty › Ứng dụng (bảng): luật thuần cho cột Trạng thái (+ lý do), cột Quy trình ("2 bật · 1 tắt") và dải "Cần xử lý".
// Nguồn việc/quy trình: `flowGroups` của tab Quy trình (một nguồn, c11). App đọc từ cột `app` của feature (c18), không suy từ tiền tố.
import type { FlowGroup } from "../../flows/lib/flow-rows";
import { type AppCard, type AppLevel, detectLevel } from "../../lib/feature-assign";

/** App đang bật theo bản nháp: Cơ bản luôn bật · mức ≠ Tắt · công tắc chính · có tính năng nào bật (dạng danh sách). */
export function isAppOn(card: AppCard, draft: ReadonlySet<string>): boolean {
  if (card.mode === "core") return true;
  if (card.mode === "levels") return detectLevel(card, draft).level !== "off";
  if (card.mode === "switch") return draft.has(card.main?.key ?? "");
  return card.addons.some((f) => draft.has(f.key));
}

/**
 * "Ứng dụng đang bật x / y": MỘT cách đếm cho mọi chỗ — Cơ bản (luôn bật, không phải lựa chọn) KHÔNG tính; y = số ứng dụng chọn được.
 */
export function appsOnCount(
  cards: readonly AppCard[],
  draft: ReadonlySet<string>,
): { on: number; total: number } {
  const choosable = cards.filter((c) => c.mode !== "core");
  return { on: choosable.filter((c) => isAppOn(c, draft)).length, total: choosable.length };
}

export type FlowCount = { on: number; off: number };

/** "x bật · y tắt" của từng app (app không có việc ⇒ không có mục). */
export function flowCounts(groups: readonly FlowGroup[]): Map<string, FlowCount> {
  return new Map(
    groups.map((g) => [
      g.app,
      {
        on: g.jobs.filter((j) => j.status === "on").length,
        off: g.jobs.filter((j) => j.status === "off").length,
      },
    ]),
  );
}

export type Attention = { app: string; slot: string };

/** Dải "Cần xử lý": việc đang tắt của app công ty ĐANG dùng (app tắt thì không phải việc cần làm). */
export function attentionOf(
  groups: readonly FlowGroup[],
  appIsOn: (app: string) => boolean,
): Attention[] {
  return groups
    .filter((g) => appIsOn(g.app))
    .flatMap((g) =>
      g.jobs.filter((j) => j.status === "off").map((j) => ({ app: g.app, slot: j.slot })),
    );
}

export type RowStatus =
  | { kind: "on"; always?: true }
  | { kind: "off" }
  | { kind: "nonstandard" }
  | { kind: "attention"; slot: string };

/** Trạng thái một hàng app kèm lý do: Cơ bản luôn bật · app Tắt · quyền không chuẩn · còn việc chưa gán quy trình · đang bật. */
export function rowStatus(
  card: Pick<AppCard, "mode">,
  level: { level: AppLevel; consistent: boolean } | null,
  isOn: boolean,
  offJobs: readonly Attention[],
): RowStatus {
  if (card.mode === "core") return { kind: "on", always: true };
  if (!isOn) return { kind: "off" };
  if (level && !level.consistent) return { kind: "nonstandard" };
  const first = offJobs[0];
  return first ? { kind: "attention", slot: first.slot } : { kind: "on" };
}
