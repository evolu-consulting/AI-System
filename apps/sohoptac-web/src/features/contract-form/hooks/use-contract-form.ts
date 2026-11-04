// V2-F · HD-01 · 5.5a: trạng thái + lưu của form nhập tay — kiểm số, ô bắt buộc (viền đỏ), dòng chưa gắn SP, tạo SP mới từ dòng (5.5c;
// HĐ Mua ⇒ NCC chính, 5.5d) rồi `POST /contracts/manual` với `product_id` từng dòng; xong mở HĐ mới.
import type { ContractDeal } from "@ai/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { attachToFrame, createDeal, createManualContract } from "~/features/contract-new/api";
import { saveErrorText } from "~/features/contract-review/lib/save-error";
import { linkNewFormLines } from "~/features/product-links/api";
import { fetchProducts, PRODUCTS_KEY } from "../api";
import { blockerMessage } from "../lib/blocker";
import { type DealExtra, EMPTY_EXTRA, toDealRequest } from "../lib/deal-form";
import {
  EMPTY_FORM,
  EMPTY_LINE,
  type FormState,
  type LineState,
  missingRequired,
  NEW_PRODUCT,
  type RequiredKey,
  readNumbers,
  type TextKey,
  toRequest,
  unlinkedLines,
  withNoticeDefault,
} from "../lib/form-model";
import { useNoticeDefault } from "./use-notice-default";

/** Áp một phần sửa lên dòng: gợi ý đến muộn không đè lựa chọn tay; sửa tên sau khi chọn do gợi ý ⇒ chọn lại. */
export function patchOneLine(l: LineState, p: Partial<LineState>): LineState {
  if (p.suggested && l.product_id) return l;
  if (p.name !== undefined && l.suggested)
    return { ...l, ...p, product_id: "", component_id: "", suggested: false };
  return { ...l, ...p };
}

/** Mỗi dòng có tên ⇒ id SP đã chọn sẵn; "tạo mới" ⇒ null. products-confirm: KHÔNG tạo SP lúc lưu — SP mới chỉ được tạo khi HĐ đã
 *  xác nhận (`linkNewFormLines` sau khi lưu ra `active`, hoặc hộp "Gắn sản phẩm" lúc duyệt). */
export function productIdsOf(f: FormState): (string | null)[] {
  return f.items
    .filter((x) => x.name.trim())
    .map((l) => (l.product_id && l.product_id !== NEW_PRODUCT ? l.product_id : null));
}

type SetForm = Dispatch<SetStateAction<FormState>>;

/** Các thao tác sửa form (ổn định tham chiếu). */
function useFormEditors(setF: SetForm) {
  const set = useCallback((k: TextKey, v: string) => setF((s) => ({ ...s, [k]: v })), [setF]);
  const setDeal = useCallback(
    (deal: ContractDeal) => {
      // Giới thiệu chỉ gắn SP nhóm Giới thiệu (5.5c): đổi loại ⇒ bỏ các lựa chọn SP đã chọn để chọn lại theo loại mới.
      setF((s) => ({
        ...s,
        deal,
        items: s.items.map((l) => ({ ...l, product_id: "", component_id: "", suggested: false })),
      }));
    },
    [setF],
  );
  const patchLine = useCallback(
    (i: number, p: Partial<LineState>) =>
      setF((s) => ({ ...s, items: s.items.map((l, j) => (j === i ? patchOneLine(l, p) : l)) })),
    [setF],
  );
  const addLine = useCallback(
    () => setF((s) => ({ ...s, items: [...s.items, { ...EMPTY_LINE }] })),
    [setF],
  );
  const removeLine = useCallback(
    (i: number) => setF((s) => ({ ...s, items: s.items.filter((_, j) => j !== i) })),
    [setF],
  );
  return { set, setDeal, patchLine, addLine, removeLine };
}

/** Tạo Giao dịch, gắn HĐ nguyên tắc (nếu chọn; lỗi gắn không làm mất giao dịch đã lưu), gắn SP mới. */
async function saveDeal(
  f: FormState,
  deal: DealExtra & { source: Exclude<DealExtra["source"], ""> },
  t: (k: string) => string,
): Promise<DealSaved> {
  const res = await createDeal(toDealRequest(f, readNumbers(f), productIdsOf(f), deal));
  let attachError: string | null = null;
  if (deal.frame) {
    try {
      await attachToFrame(deal.frame.id, [res.id]);
    } catch (x) {
      attachError = saveErrorText(x, t);
    }
  }
  await linkNewFormLines(res.id, res.status, f.items);
  return { id: res.id, settleError: res.settle_error, attachError };
}

/** Kết quả lưu Giao dịch khi cần ở lại màn hình báo: "xác nhận ngay" dừng giữa chừng và/hoặc gắn HĐ nguyên tắc lỗi. */
export type DealSaved = { id: string; settleError: string | null; attachError: string | null };

/** Lưu: chặn lỗi ⇒ câu báo; ổn ⇒ tạo HĐ (hoặc Giao dịch, `deal`) rồi mở bản mới. */
function useSubmit(
  f: FormState,
  setTried: (v: boolean) => void,
  deal: DealExtra | undefined,
  setSaved: (s: DealSaved) => void,
) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setErr(null);
    const stop = blockerMessage(
      f,
      t,
      () => setTried(true),
      (msg) => toast(msg, "late"),
    );
    if (stop) return setErr(stop);
    if (deal && !deal.source) return setErr(t("contracts.doclist.sourceRequired"));
    setBusy(true);
    try {
      if (deal?.source) {
        const s = await saveDeal(f, { ...deal, source: deal.source }, t);
        await qc.invalidateQueries();
        toast(t("contracts.doclist.saved"));
        if (s.settleError || s.attachError) return setSaved(s);
        return void (await nav({ to: "/contracts/$id", params: { id: s.id } }));
      }
      const rec = await createManualContract(toRequest(f, readNumbers(f), productIdsOf(f)));
      await linkNewFormLines(rec.id, rec.status, f.items);
      await qc.invalidateQueries();
      toast(t("contracts.cform.saved"));
      await nav({ to: "/contracts/$id", params: { id: rec.id } });
    } catch (x) {
      setErr(saveErrorText(x, t));
    } finally {
      setBusy(false);
    }
  }
  return { err, busy, submit };
}

export function useContractForm(mode: "contract" | "deal" = "contract", frameId?: string) {
  // V2-H: "Nhắc trước khi hết hạn" để trống tới khi đọc xong Cài đặt rồi điền sẵn (người đã gõ thì giữ).
  const [f, setF] = useState<FormState>({ ...EMPTY_FORM, notice_days: "" });
  // DOC-ui-list: phần riêng của Giao dịch (nguồn, đã giao/đã thanh toán ngay, HĐ nguyên tắc chủ) + kết quả lưu cần ở lại báo.
  const [extra, setExtra] = useState<DealExtra>(
    frameId ? { ...EMPTY_EXTRA, frame: { id: frameId, title: "" } } : EMPTY_EXTRA,
  );
  const [saved, setSaved] = useState<DealSaved | null>(null);
  const notice = useNoticeDefault();
  useEffect(() => setF((s) => withNoticeDefault(s, notice)), [notice]);
  const [tried, setTried] = useState(false);
  const products = useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: ({ signal }) => fetchProducts(signal),
    staleTime: 60_000,
  });
  const invalid = useMemo<Set<RequiredKey>>(
    () => (tried ? new Set(missingRequired(f)) : new Set()),
    [tried, f],
  );
  const unlinked = useMemo<Set<number>>(
    () => (tried ? new Set(unlinkedLines(f)) : new Set()),
    [tried, f],
  );
  const editors = useFormEditors(setF);
  const { err, busy, submit } = useSubmit(
    f,
    setTried,
    mode === "deal" ? extra : undefined,
    setSaved,
  );
  return {
    f,
    ...editors,
    invalid,
    unlinked,
    err,
    busy,
    submit,
    products: products.data ?? [],
    extra,
    setExtra,
    saved,
    sourceMissing: tried && mode === "deal" && !extra.source,
  };
}
