// products-confirm: gắn/tạo SP cho dòng HĐ đã xác nhận (`POST /contracts/:id/product-links`, quyền ghi).
import type { ContractStatus, ProductLink, ProductLinksResult } from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";
import type { LineState } from "~/features/contract-form/lib/form-model";
import { fetchContract } from "~/features/contract-review/api";
import { newLinksOfForm } from "./lib/links";

export const linkProducts = (id: string, links: ProductLink[]) =>
  api<ProductLinksResult>(`/pack/contracts/contracts/${encodeURIComponent(id)}/product-links`, {
    method: "POST",
    body: { links },
  });

/** Lưu xong mà HĐ đã duyệt xong (`done`): tạo SP mới cho dòng chọn "tạo SP mới" trong form (chưa xác nhận ⇒ không tạo gì). */
export async function linkNewFormLines(
  id: string,
  status: ContractStatus,
  lines: readonly LineState[],
): Promise<void> {
  if (status !== "done") return;
  const links = newLinksOfForm(lines, (await fetchContract(id)).items);
  if (links.length) await linkProducts(id, links);
}
