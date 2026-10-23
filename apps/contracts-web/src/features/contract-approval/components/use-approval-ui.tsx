// HD-FR-36 · S05: ghép thẻ duyệt cho trang kiểm/sửa — nút trên tiêu đề + khối dưới tiêu đề (ghi chú / lý do), giữ trang gọn.
// `saveFirst` (trang cấp) lưu ô đã đổi trước khi "Xác nhận" như mgmt-app.
// products-confirm: "Xác nhận"/"Duyệt" mà máy chủ báo sẽ xác nhận HĐ (`finalizes_on_approve`) ⇒ (lưu ô đã đổi) ⇒ hộp "Gắn sản phẩm"
// ⇒ gửi lựa chọn cùng `approve`. Bước chỉ chuyển cấp 2 / HĐ không có dòng hàng ⇒ duyệt thẳng như trước.
import type { ProductLink } from "@ai/contracts";
import { type ReactNode, useState } from "react";
import { fetchProducts } from "~/features/contract-form/api";
import { fetchContract } from "~/features/contract-review/api";
import {
  ProductLinkDialog,
  type ProductLinkTarget,
} from "~/features/product-links/components/ProductLinkDialog";
import { useApproval } from "../hooks/use-approval";
import { type ApprovalView, approvalView, showLinkDialog } from "../lib/approval";
import { ApprovalButtons, ApprovalNote, ExtractedValue, ReasonForm } from "./ApprovalParts";

export type ApprovalUi = {
  buttons: ReactNode;
  section: ReactNode;
  busy: boolean;
  msg: string | null;
  err: string | null;
  view: ApprovalView;
};

type LinkStep = { target: ProductLinkTarget; label: string | undefined };

export function useApprovalUi(o: {
  id: string;
  contractKey: readonly unknown[];
  write: boolean;
  hasSource: boolean;
  saveFirst: () => Promise<void>;
  /** Giá trị HĐ AI đọc (trường `total_value`) — hiện ở cấp 1 cùng trích dẫn (review m8). */
  extracted?: { value: unknown; quote: string; edited: boolean } | undefined;
}): ApprovalUi {
  const ap = useApproval(o.id, o.contractKey);
  const [ask, setAsk] = useState<"reject" | "redo" | null>(null);
  const [link, setLink] = useState<LinkStep | null>(null);
  const v = approvalView(ap.approval, { write: o.write, hasSource: o.hasSource });
  const approve = async (before: (() => Promise<void>) | undefined, label?: string) => {
    // Bước này chưa xác nhận HĐ (cấp 1 ⇒ cấp 2) ⇒ duyệt thẳng, không hộp; người duyệt cấp 2 sẽ thấy hộp.
    if (!showLinkDialog(ap.approval, 1)) return void ap.act({ action: "approve" }, before, label);
    const got = await ap.prepare(async () => {
      await before?.();
      return Promise.all([fetchContract(o.id), fetchProducts()]);
    });
    if (!got) return;
    const [c, products] = got;
    if (!showLinkDialog(ap.approval, c.items.length))
      return void ap.act({ action: "approve" }, undefined, label);
    setLink({ target: { items: c.items, products, deal: c.deal }, label });
  };
  const confirmLinks = async (products: ProductLink[]) => {
    const label = link?.label;
    if (await ap.act({ action: "approve", products }, undefined, label)) setLink(null);
  };
  const buttons = (
    <ApprovalButtons
      v={v}
      busy={ap.busy}
      onConfirm={() => void approve(o.saveFirst, "contracts.approval.done.confirm")}
      onApprove={() => void approve(undefined)}
      onAsk={setAsk}
    />
  );
  const rejected = ap.approval?.step === "rejected" ? ap.approval.feedback : null;
  const section = (
    <>
      <ApprovalNote note={v.note} rejected={rejected} />
      {v.confirm && o.extracted && <ExtractedValue {...o.extracted} />}
      {ask && (
        <ReasonForm
          kind={ask}
          busy={ap.busy}
          onCancel={() => setAsk(null)}
          onSubmit={async (feedback) => {
            if (await ap.act({ action: ask, feedback })) setAsk(null);
          }}
        />
      )}
      <ProductLinkDialog
        target={link?.target ?? null}
        busy={ap.busy !== null}
        onCancel={() => setLink(null)}
        onConfirm={(links) => void confirmLinks(links)}
      />
    </>
  );
  return { buttons, section, busy: ap.busy !== null, msg: ap.msg, err: ap.err, view: v };
}
