// ADM-FR-51 · M4-R12 · bộ lọc Nhật ký nằm trên URL (hàm thuần): kiểm search, đổi qua lại giữa URL và Period.
import { AUDIT_ACTIONS, AUDIT_ENTITIES, type AuditAction, type AuditEntity } from "@ai/contracts";
import {
  isValidCustom,
  PERIOD_PRESETS,
  type Period,
  periodRange,
} from "@/components/shared/form/period";

export type AuditSearch = {
  tenant?: string;
  entity?: AuditEntity;
  action?: AuditAction;
  actor?: string;
  from?: string;
  to?: string;
  q?: string;
};

/** "Loại" gồm 11 mục: mọi thực thể trừ `config` (Import lọc theo Hành động). */
export const FILTER_ENTITIES = AUDIT_ENTITIES.filter((e) => e !== "config");

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.find((x) => x === v);

export function validateAuditSearch(s: Record<string, unknown>): AuditSearch {
  const from = str(s.from);
  const to = str(s.to);
  const range = from && to && isValidCustom(from, to);
  return {
    tenant: str(s.tenant),
    entity: oneOf(FILTER_ENTITIES, s.entity),
    action: oneOf(AUDIT_ACTIONS, s.action),
    actor: str(s.actor),
    from: range ? from : undefined,
    to: range ? to : undefined,
    q: str(s.q),
  };
}

/** Không có `from`/`to` → 30 ngày; khoảng trùng preset 7/30/90 (đến hôm nay) → preset. */
export function periodFromSearch(s: AuditSearch, today: Date): Period {
  if (!s.from || !s.to) return { kind: "preset", days: 30 };
  for (const days of PERIOD_PRESETS) {
    const r = periodRange({ kind: "preset", days }, today);
    if (r.from === s.from && r.to === s.to) return { kind: "preset", days };
  }
  return { kind: "custom", from: s.from, to: s.to };
}

/** Preset 30 ngày (mặc định) → không ghi lên URL. */
export function rangeForUrl(p: Period, today: Date): { from?: string; to?: string } {
  if (p.kind === "preset" && p.days === 30) return { from: undefined, to: undefined };
  return periodRange(p, today);
}

/** Bộ lọc khác mặc định (để hiện "Xoá bộ lọc"). */
export function hasFilters(s: AuditSearch): boolean {
  return Object.values(s).some((v) => v !== undefined);
}
