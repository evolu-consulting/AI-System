// V2-J2 · SP-04/05/06: tab "Nhà cung cấp & giá". `overview` = bảng so sánh + gợi ý (một tx đọc ‖ bảng uy tín NCC V2-E); `search` = AI
// tìm giá trên mạng (CHỈ khi người dùng bấm, CHỈ gửi tên SP, qua AI client gói `ai-sub`, có trần thao tác + trần token); `save` = lưu
// kết quả vào bảng so sánh; `remove`. SP nhóm Giới thiệu không có tab ⇒ 404.
import type { SupplierOverviewOut, SupplierPriceInput, SupplierSearchOut } from "@ai/contracts";
import type { AiClient } from "../../../../lib/ai-client/ai-client";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ActionQuota } from "../adapters/action-quota";
import { localDate } from "../domain/local-time.rules";
import {
  parseSearchReply,
  SEARCH_FEATURE,
  SEARCH_MODEL,
  SEARCH_SYSTEM,
  searchPrompt,
} from "../domain/price-search.rules";
import { buildOverview, type OverviewData } from "../domain/supplier-advice.rules";

export type SuppliersRepo = {
  overview(productId: string): Promise<OverviewData | null>;
  head(
    productId: string,
  ): Promise<{ name: string; group: "service" | "goods" | "referral" } | null>;
  /** null ⇒ SP không có / không thuộc tenant. */
  save(
    productId: string,
    items: SupplierPriceInput[],
    today: string,
  ): Promise<{ ids: string[] } | null>;
  remove(productId: string, priceId: string): Promise<boolean>;
};

export class SupplierFail extends Error {
  constructor(readonly kind: "not_found" | "unavailable" | "cap" | "failed") {
    super(kind);
  }
}

type Rep = { score: number | null; level: "good" | "fair" | "watch" | "new" };
export type SuppliersDeps = {
  uow: PackUow<{ suppliers: SuppliersRepo }>;
  ai: AiClient;
  /** Trần thao tác tốn AI/tenant/ngày (cùng bộ đếm với trích HĐ). */
  quota: ActionQuota;
  /** Điểm uy tín vai NCC theo khoá đối tác (V2-E). */
  reputation: (who: PackWho) => Promise<ReadonlyMap<string, Rep>>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
  /** Trần một lượt tìm web (ms). */
  searchTimeoutMs?: number;
};

export const SEARCH_TIMEOUT_MS = 180_000;

export function suppliersUsecase(d: SuppliersDeps) {
  const now = d.now ?? (() => new Date());
  const tx = <T>(who: PackWho, fn: (r: SuppliersRepo) => Promise<T>) =>
    d.uow.tenant(who, (r) => fn(r.suppliers));
  const today = async (who: PackWho) => localDate(now(), await d.timeZoneOf(who.tenantId));
  /** SP có tab này (không phải Giới thiệu) ⇒ tên; ngược lại 404. */
  async function product(who: PackWho, id: string) {
    const h = await tx(who, (r) => r.head(id));
    if (!h || h.group === "referral") throw new SupplierFail("not_found");
    return h;
  }
  return {
    async overview(who: PackWho, id: string): Promise<SupplierOverviewOut> {
      const [data, scores] = await Promise.all([tx(who, (r) => r.overview(id)), d.reputation(who)]);
      if (!data || data.product.group === "referral") throw new SupplierFail("not_found");
      return buildOverview(data, scores);
    },

    async search(who: PackWho, id: string): Promise<SupplierSearchOut> {
      const p = await product(who, id);
      await d.quota(who.tenantId);
      const out = await d.ai.complete({
        tenantId: who.tenantId,
        userId: who.userId,
        feature: SEARCH_FEATURE,
        model: process.env.CONTRACTS_PRICE_SEARCH_MODEL || SEARCH_MODEL,
        system: SEARCH_SYSTEM,
        prompt: searchPrompt(p.name), // CHỈ tên SP ra ngoài
        webSearch: true,
        signal: AbortSignal.timeout(d.searchTimeoutMs ?? SEARCH_TIMEOUT_MS),
      });
      if (!out.ok)
        throw new SupplierFail(
          out.code === "CAP_EXCEEDED"
            ? "cap"
            : out.code === "UNAVAILABLE"
              ? "unavailable"
              : "failed",
        );
      const items = parseSearchReply(out.text, await today(who));
      if (!items) throw new SupplierFail("failed");
      return { query: p.name, items };
    },

    async save(who: PackWho, id: string, items: SupplierPriceInput[]): Promise<{ ids: string[] }> {
      await product(who, id);
      const day = await today(who);
      const r = await tx(who, (x) => x.save(id, items, day));
      if (!r) throw new SupplierFail("not_found");
      return r;
    },

    async remove(who: PackWho, id: string, priceId: string): Promise<void> {
      if (!(await tx(who, (r) => r.remove(id, priceId)))) throw new SupplierFail("not_found");
    },
  };
}
export type SuppliersUsecase = ReturnType<typeof suppliersUsecase>;
