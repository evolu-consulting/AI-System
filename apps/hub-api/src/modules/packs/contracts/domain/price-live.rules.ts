// CR-127 K2a-2 (BR-07, spec §2.1): "HĐ còn hiệu lực cho giá" — MỘT định nghĩa cho sourcing / goods-prices / supplier-advice
// (trước đây 3 bản `LIVE` trên 9 trạng thái). Trạng thái `done` + hiệu lực `effect` ∈ {active, expiring, renewed}.
// Thuần. `effect` vắng/null (HĐ chưa nạp cột hiệu lực, bản đã bị thay) ⇒ không còn hiệu lực.

export const PRICE_LIVE_EFFECTS: ReadonlySet<string> = new Set(["active", "expiring", "renewed"]);

export function isPriceLive(c: { status: string; effect?: string | null }): boolean {
  return c.status === "done" && c.effect != null && PRICE_LIVE_EFFECTS.has(c.effect);
}

/** Nhãn hiệu lực đưa ra ngoài (`SourceRef.status`): HĐ `done` ⇒ `effect`; còn lại giữ trạng thái. */
export const effectiveStateOf = (c: { status: string; effect?: string | null }): string =>
  c.status === "done" && c.effect ? c.effect : c.status;
