// CR-188 · BR-188-4 · số bản của từng phiên bản chữ ký: cũ nhất = 1, mỗi loại (chính / tắt) đếm riêng. Lịch sử máy chủ trả MỚI → CŨ.
import type { MySignatureHistoryRow } from "@ai/contracts/signature";

export type VersionRow = MySignatureHistoryRow & { number: number; current: boolean };

export function numberVersions(history: readonly MySignatureHistoryRow[]): VersionRow[] {
  const total = new Map<string, number>();
  for (const h of history) total.set(h.kind, (total.get(h.kind) ?? 0) + 1);
  const seen = new Map<string, number>();
  return history.map((h) => {
    const before = seen.get(h.kind) ?? 0;
    seen.set(h.kind, before + 1);
    return { ...h, number: (total.get(h.kind) ?? 0) - before, current: h.retired_at === null };
  });
}
