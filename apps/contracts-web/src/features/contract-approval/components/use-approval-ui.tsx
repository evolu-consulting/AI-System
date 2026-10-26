// HD-FR-36 · S05: ghép thẻ duyệt cho trang kiểm/sửa — nút trên tiêu đề + khối dưới tiêu đề (ghi chú / lý do), giữ trang gọn.
// `saveFirst` (trang cấp) lưu ô đã đổi trước khi "Xác nhận" như mgmt-app.
// products-confirm: "Xác nhận"/"Duyệt" mà máy chủ báo sẽ xác nhận HĐ (`finalizes_on_approve`) ⇒ (lưu ô đã đổi) ⇒ hộp "Gắn sản phẩm"
// ⇒ gửi lựa chọn cùng `approve`. Bước chỉ chuyển cấp 2 / HĐ không có dòng hàng ⇒ duyệt thẳng như trước.
import type { ProductLink } from "@ai/contracts";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { fetchProducts } from "~/features/contract-form/api";
import { fetchContract } from "~/features/contract-review/api";
import {
  ProductLinkDialog,
  type ProductLinkTarget,
} from "~/features/product-links/components/ProductLinkDialog";
import { fetchApproval } from "../api";
import { useApproval } from "../hooks/use-approval";
import {
  type ActResult,
  type ApprovalView,
  afterConfirm,
  approvalView,
  showLinkDialog,
} from "../lib/approval";
import { releaseNoteKey } from "../lib/engine-card";
import { ApprovalButtons, ApprovalNote, ExtractedValue, ReasonForm } from "./ApprovalParts";
import { ApprovalTimeline } from "./ApprovalTimeline";

export type ApprovalUi = {
  buttons: ReactNode;
  section: ReactNode;
  busy: boolean;
  msg: string | null;
  err: string | null;
  view: ApprovalView;
  /** Đã tải trạng thái duyệt + bước hiện tại (null = tenant tắt duyệt / chưa có lượt) — cho luật nút đầu trang. */
  loaded: boolean;
  step: string | null;
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
  // confirm-flow: "Đọc lại" (trích lại kèm lý do) ẩn theo người dùng 2026-10-23 ⇒ hộp lý do chỉ còn "Từ chối".
  const [ask, setAsk] = useState<"reject" | "return" | null>(null);
  const v = approvalView(ap.approval, { write: o.write, hasSource: o.hasSource });
  const { link, setLink, approve, confirmLinks } = useConfirmFlow(o.id, ap);
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
  // Lượt bị trả về máy cũ vì engine hỏng/hết hạn (`ENGINE_RUN_*`): nói rõ vì sao thay vì im lặng.
  const note =
    v.note ?? (ap.approval?.mode === "engine" ? null : releaseNoteKey(ap.approval?.feedback));
  const section = (
    <>
      {ap.approval && <ApprovalTimeline a={ap.approval} />}
      <ApprovalNote note={note} rejected={rejected} />
      {v.confirm && o.extracted && <ExtractedValue {...o.extracted} />}
      {ask && (
        <ReasonForm
          kind={ask}
          busy={ap.busy}
          onCancel={() => setAsk(null)}
          onSubmit={async (feedback) => {
            if ((await ap.act({ action: ask, feedback })).ok) setAsk(null);
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
  return {
    buttons,
    section,
    busy: ap.busy !== null,
    msg: ap.msg,
    err: ap.err,
    view: v,
    loaded: ap.approval !== undefined,
    step: ap.approval?.step ?? null,
  };
}

/** "Xác nhận và lưu" / "Duyệt" ⇒ (lưu ô đã đổi) ⇒ (hộp "Gắn sản phẩm") ⇒ `approve`; kết quả đóng hộp + tải lại + báo. */
function useConfirmFlow(id: string, ap: ReturnType<typeof useApproval>) {
  const { t } = useTranslation();
  const [link, setLink] = useState<LinkStep | null>(null);
  /** Kết quả "Xác nhận"/"Duyệt" ⇒ đóng hộp, tải lại, báo (cấp 2 ⇒ chờ BGĐ; bước đã đổi ⇒ câu rõ ràng). */
  const settle = async (r: ActResult) => {
    const next = afterConfirm(r);
    if (next.close) setLink(null);
    if (next.toast) {
      ap.setMsg(t(next.toast));
      toast(t(next.toast));
    }
    if (!r.ok && next.refetch) {
      ap.setErr(t("contracts.approval.errors.changedReloaded"));
      await ap.refresh();
    }
  };
  const approve = async (before: (() => Promise<void>) | undefined, label?: string) => {
    // Bước này chưa xác nhận HĐ (cấp 1 ⇒ cấp 2) ⇒ duyệt thẳng, không hộp; người duyệt cấp 2 sẽ thấy hộp.
    if (!showLinkDialog(ap.approval, 1))
      return settle(await ap.act({ action: "approve" }, before, label));
    // Lưu ô đã đổi (KHÔNG mở lại lượt / đọc lại — sửa ở cấp 1 giữ lượt đang mở, D3-14) rồi đọc lại trạng thái duyệt MỚI: giá trị vừa
    // sửa có thể làm bước này chuyển cấp 2 thay vì xác nhận HĐ.
    const step0 = ap.approval?.step;
    const got = await ap.prepare(async () => {
      await before?.();
      return Promise.all([fetchContract(id), fetchProducts(), fetchApproval(id)]);
    });
    if (!got) return;
    // Đã lưu ⇒ nạp lại HĐ (version mới cho form; Huỷ hộp rồi bấm lại không bị "đã bị sửa").
    if (before) await ap.refresh();
    const [c, products, fresh] = got;
    if (fresh.step !== step0 || !fresh.can_act || fresh.task_id !== ap.approval?.task_id)
      return settle({ ok: false, code: "APPROVAL_NOT_OPEN" });
    if (!showLinkDialog(fresh, c.items.length))
      return settle(await ap.act({ action: "approve" }, undefined, label));
    setLink({ target: { items: c.items, products, deal: c.deal }, label });
  };
  const confirmLinks = async (products: ProductLink[]) => {
    const r = await ap.act({ action: "approve", products }, undefined, link?.label);
    if (!r.ok && r.code === "IN_FLIGHT") return;
    await settle(r);
  };
  return { link, setLink, approve, confirmLinks };
}
