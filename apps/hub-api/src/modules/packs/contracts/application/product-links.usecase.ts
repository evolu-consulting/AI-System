// products-confirm · BA 5.5: gắn/tạo SP cho dòng HĐ khi HĐ đã xác nhận (lớp 2 — không SQL). MỘT tx `PackUow`; xong ⇒ outbox HĐ.
// Bước duyệt cuối gọi cùng cổng `ProductLinksRepo` TRONG tx của nó (approval.usecase) — không qua hàm này.
import type { ProductLink } from "@ai/contracts";
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";

export type ProductLinksOutcome =
  | { kind: "ok"; created: number; linked: number }
  | { kind: "not_found" | "not_confirmed" | "locked" };

export type ProductLinksRepo = {
  /** MỘT câu: SP mới + gắn dòng HĐ; HĐ không thấy / chưa xác nhận / có dòng kho ⇒ không đổi gì. */
  link(
    contractId: string,
    links: readonly ProductLink[],
    actor: string,
  ): Promise<ProductLinksOutcome>;
};
export type ProductLinksTxRepos = { links: ProductLinksRepo } & KitTxRepos;

export function linkContractProducts(d: { uow: PackUow<ProductLinksTxRepos> }) {
  return (who: PackWho, id: string, links: readonly ProductLink[]): Promise<ProductLinksOutcome> =>
    d.uow.tenant(who, async (r) => {
      const out = await r.links.link(id, links, who.userId);
      if (out.kind === "ok" && out.linked > 0)
        await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return out;
    });
}
export type LinkContractProducts = ReturnType<typeof linkContractProducts>;
