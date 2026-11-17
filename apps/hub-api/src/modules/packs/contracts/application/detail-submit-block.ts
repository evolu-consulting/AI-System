// CR-127 · NF1 (người dùng chốt 2026-11-10) · Luật GỐC 3: báo TRƯỚC khi bấm "Gửi duyệt" vì sao không gửi được. HĐ DRAFT (bản hiện hành) ⇒ hỏi
// `flowOpen` (= `submitFlowOpen`, cùng `flowOf` của lệnh Gửi — một nguồn sự thật); không có quy trình khớp ⇒ `submit_block = 'no_flow'` + `can.submit = false`.
// HĐ không ở DRAFT ⇒ 0 truy vấn thêm. Bọc `detail` như `withExpiryCan`; danh sách không dùng (không N+1).
import type { PackWho } from "../../kit/public";
import type { Can } from "./contract-can";
import type { GetContract } from "./get-contract.usecase";

type DetailLike = {
  id: string;
  status: string;
  superseded: boolean;
  can: Can;
  submit_block?: "no_flow" | "sign_no_files" | "sign_missing_fields" | null;
};

export function withSubmitBlock<D extends DetailLike>(
  inner: GetContract<D>,
  flowOpen: (
    who: PackWho,
    id: string,
  ) => Promise<boolean | "sign_no_files" | "sign_missing_fields">,
  onError?: (e: unknown) => void,
): GetContract<D> {
  return async (who, id) => {
    const c = await inner(who, id);
    if (!c) return c;
    if (c.status !== "draft" || c.superseded) return { ...c, submit_block: null };
    // NF1b · trường gợi ý: tra quy trình lỗi ⇒ không làm hỏng cả chi tiết (null = chưa biết; lệnh Gửi vẫn tự kiểm lại).
    const open = await flowOpen(who, c.id).catch((e: unknown) => {
      onError?.(e);
      return null;
    });
    if (open === true || open === null) return { ...c, submit_block: null };
    // CR-181 · BR-T2/C3 · lý do ký trên tài liệu (thiếu tệp cần ký / thiếu chỗ ký) cũng chặn Gửi.
    return {
      ...c,
      can: { ...c.can, submit: false },
      submit_block: open === false ? "no_flow" : open,
    };
  };
}
