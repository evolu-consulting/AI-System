// V2-GAPS · C10: gom "Uy tín của mình" từ hàng thô của SQL (thuần). Mốc của mình đã xong: trễ = `done_at > due_date`; lỗi chỉ có khi trễ
// (null ⇒ chưa rõ). Không phụ thuộc DB.

export type MineRaw = {
  deal: "buy" | "sell" | "referral" | null;
  party: string;
  name: string | null;
  total: number;
  late: number;
  fault_ours: number;
  fault_partner: number;
  fault_unknown: number;
};

export type Mine = {
  days: number;
  total: number;
  late: number;
  on_time_pct: number | null;
  by_fault: { ours: number; partner: number; unknown: number };
  by_deal: { deal: "buy" | "sell" | "referral"; total: number; late: number }[];
  blamed: { party: string; name: string; late: number }[];
};

const DEALS = ["sell", "buy", "referral"] as const;

export function mineSummary(rows: readonly MineRaw[], days: number): Mine {
  let total = 0;
  let late = 0;
  const by_fault = { ours: 0, partner: 0, unknown: 0 };
  const deals = new Map<string, { total: number; late: number }>();
  for (const r of rows) {
    total += r.total;
    late += r.late;
    by_fault.ours += r.fault_ours;
    by_fault.partner += r.fault_partner;
    by_fault.unknown += r.fault_unknown;
    const k = r.deal ?? "sell";
    const d = deals.get(k) ?? { total: 0, late: 0 };
    deals.set(k, { total: d.total + r.total, late: d.late + r.late });
  }
  const blamed = new Map<string, { name: string; late: number }>();
  for (const r of rows) {
    if (r.fault_partner <= 0) continue;
    const x = blamed.get(r.party);
    blamed.set(r.party, {
      name: x?.name ?? r.name ?? r.party.replace(/^(tax|name):/, ""),
      late: (x?.late ?? 0) + r.fault_partner,
    });
  }
  return {
    days,
    total,
    late,
    on_time_pct: total === 0 ? null : Math.round(((total - late) / total) * 100),
    by_fault,
    by_deal: DEALS.filter((k) => deals.has(k)).map((k) => ({
      deal: k,
      ...(deals.get(k) as { total: number; late: number }),
    })),
    blamed: [...blamed.entries()]
      .map(([party, v]) => ({ party, ...v }))
      .sort((a, b) => b.late - a.late || a.party.localeCompare(b.party))
      .slice(0, 3),
  };
}

/** Ngày bắt đầu khoảng (YYYY-MM-DD, `today` − `days`). */
export function mineFrom(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}
