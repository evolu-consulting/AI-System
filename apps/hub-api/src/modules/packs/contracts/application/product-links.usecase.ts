// products-confirm · BA 5.5: gắn/tạo SP cho dòng HĐ khi HĐ đã xác nhận (lớp 2 — không SQL). MỘT tx `PackUow`; xong ⇒ outbox HĐ.
// Bước duyệt cuối gọi cùng cổng `ProductLinksRepo` TRONG tx của nó (approval.usecase) — không qua hàm này.
import type { ProductLink } from "@ai/contracts";
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";

export type ProductLinksOutcome =
  /** `matched`: số link gửi lên trỏ đúng dòng của HĐ (dòng lạ bị bỏ qua — gọi nơi cần chặt thì so với số gửi). */
  | { kind: "ok"; created: number; linked: number; matched: number }
  | { kind: "not_found" | "not_confirmed" | "locked" | "contract_locked" };

export type ProductLinksRepo = {
  /** MỘT câu: SP mới + gắn dòng HĐ; HĐ không thấy / chưa xác nhận / có dòng kho ⇒ không đổi gì. */
  link(
    contractId: string,
    links: readonly ProductLink[],
    actor: string,
    /** lock-strict: đường route (không phải bước duyệt / lệnh xác nhận) ⇒ HĐ đã khoá (`locked_at`) ⇒ `contract_locked` (MỌI
     *  link, kể cả gắn lần đầu — atomic-confirm). Bước duyệt cuối / POST /review xác nhận gọi không strict TRONG tx khoá. */
    strict?: boolean,
  ): Promise<ProductLinksOutcome>;
};
export type ProductLinksTxRepos = { links: ProductLinksRepo } & KitTxRepos;

export function linkContractProducts(d: { uow: PackUow<ProductLinksTxRepos> }) {
  return (who: PackWho, id: string, links: readonly ProductLink[]): Promise<ProductLinksOutcome> =>
    d.uow.tenant(who, async (r) => {
      const out = await r.links.link(id, links, who.userId, true);
      if (out.kind === "ok" && out.linked > 0)
        await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return out;
    });
}
export type LinkContractProducts = ReturnType<typeof linkContractProducts>;
