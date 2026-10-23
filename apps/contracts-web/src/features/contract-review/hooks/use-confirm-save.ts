// atomic-confirm (người dùng 2026-10-24): "Xác nhận và lưu" khi tenant TẮT duyệt — giống thẻ duyệt (bật duyệt): ghi nháp (HĐ chưa
// khoá) ⇒ hộp "Gắn sản phẩm" (HĐ có dòng) ⇒ MỘT `POST /review` {version, products}: xác nhận + khoá + gắn/tạo SP trong cùng tx.
import type { ProductLink } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { fetchProducts } from "~/features/contract-form/api";
import type { ProductLinkTarget } from "~/features/product-links/components/ProductLinkDialog";
import { contractKey, fetchContract, saveReview } from "../api";
import { afterConfirmSave, confirmSaveBody, needsLinkDialog } from "../lib/confirm-save";
import { savedNoticeKey } from "../lib/review";
import { saveErrorText } from "../lib/save-error";

type Target = ProductLinkTarget & { version: number };
const codeOf = (e: unknown): string | null => (e instanceof ApiError ? (e.code as string) : null);

export function useConfirmSave(id: string, prepare: () => Promise<void>) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errText = (e: unknown) =>
    e instanceof Error && !("status" in e) ? e.message : saveErrorText(e, t);
  const reload = async () => {
    await qc.invalidateQueries({ queryKey: contractKey(id) });
    await qc.invalidateQueries({ queryKey: ["contracts", "list"] });
  };
  /** Gửi lệnh xác nhận (kèm lựa chọn SP) ⇒ đóng hộp / giữ hộp theo `afterConfirmSave`. */
  const confirmWith = async (version: number, links: readonly ProductLink[]) => {
    let r: { ok: true } | { ok: false; code: string | null };
    try {
      await saveReview(id, confirmSaveBody(version, links));
      r = { ok: true };
    } catch (e) {
      r = { ok: false, code: codeOf(e) };
      setErr(errText(e));
    }
    const next = afterConfirmSave(r);
    if (next.close) setTarget(null);
    if (next.refetch) await reload();
    if (r.ok) toast(t(savedNoticeKey("active", true)));
  };
  const start = async () => {
    setErr(null);
    setBusy(true);
    try {
      await prepare();
      const [c, products] = await Promise.all([fetchContract(id), fetchProducts()]);
      // Đã ghi nháp ⇒ nạp lại HĐ (form theo version mới; Huỷ hộp rồi bấm lại không bị "đã bị sửa").
      await qc.invalidateQueries({ queryKey: contractKey(id) });
      if (needsLinkDialog(c.items.length))
        setTarget({ items: c.items, products, deal: c.deal, version: c.version });
      else await confirmWith(c.version, []);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmLinks = async (links: ProductLink[]) => {
    if (!target || busy) return;
    setErr(null);
    setBusy(true);
    try {
      await confirmWith(target.version, links);
    } finally {
      setBusy(false);
    }
  };
  return { target, busy, err, start, confirmLinks, cancel: () => setTarget(null) };
}
