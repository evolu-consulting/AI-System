// CR-112 · ADM-FR-79 (bước Xem lại) · tab Tổng quan (COULD) · luật thuần tóm tắt công ty: app đang bật + mức, quota tháng (chỉ run/token).
import type { QuotaStatus } from "@ai/contracts";
import type { AppId } from "@/features/features/lib/feature-meta";
import { type AppCard, type AppLevel, detectLevel } from "./feature-assign";

export type AppOn = { app: AppId; level: AppLevel | "on" };

/** App đang bật: dạng mức ⇒ mức hiện có (≠ Tắt); dạng công tắc/danh sách ⇒ "on" khi có feature đã cấp. `core` luôn bật nên bỏ. */
function levelOf(card: AppCard, entitled: ReadonlySet<string>): AppOn["level"] | null {
  if (card.mode === "core") return null;
  if (card.mode === "levels") {
    const { level } = detectLevel(card, entitled);
    return level === "off" ? null : level;
  }
  const on =
    card.mode === "switch" && card.main
      ? entitled.has(card.main.key)
      : card.addons.some((f) => entitled.has(f.key));
  return on ? "on" : null;
}

export function appsOn(cards: readonly AppCard[], entitled: ReadonlySet<string>): AppOn[] {
  return cards.flatMap((card) => {
    const level = levelOf(card, entitled);
    return level ? [{ app: card.app, level }] : [];
  });
}

/** Hàng "Cả tenant" của quota (feature_id null); thiếu ⇒ undefined. */
export const tenantQuotaRow = (items: readonly QuotaStatus[]): QuotaStatus | undefined =>
  items.find((i) => i.feature_id === null);

/** Dòng quota rút gọn (không tiền): chỉ run + token, theo thứ tự server trả (dòng tenant đầu). */
export type QuotaLine = {
  key: string;
  featureName: QuotaStatus["feature_name"];
  runs: { used: number; limit: number | null };
  tokens: { used: number; limit: number | null };
  pct: number | null;
  level: QuotaStatus["level"];
};

export function quotaLines(items: readonly QuotaStatus[]): QuotaLine[] {
  return items.map((i) => ({
    key: i.feature_id ?? "tenant",
    featureName: i.feature_name,
    runs: { used: i.used.runs, limit: i.max_runs },
    tokens: { used: i.used.tokens, limit: i.max_tokens },
    pct: i.pct,
    level: i.level,
  }));
}
