// V2-F · HD-01 · 5.5a: trạng thái + lưu của form nhập tay — kiểm số, ô bắt buộc (viền đỏ), dòng chưa gắn SP, tạo SP mới từ dòng (5.5c;
// HĐ Mua ⇒ NCC chính, 5.5d) rồi `POST /contracts/manual` với `product_id` từng dòng; xong mở HĐ mới.
import type { ContractDeal } from "@ai/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { createManualContract } from "~/features/contract-new/api";
import { saveErrorText } from "~/features/contract-review/lib/save-error";
import { createProduct, fetchProducts, PRODUCTS_KEY } from "../api";
import { PARTNER_ROLE } from "../lib/deal";
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
} from "../lib/form-model";

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** Áp một phần sửa lên dòng: gợi ý đến muộn không đè lựa chọn tay; sửa tên sau khi chọn do gợi ý ⇒ chọn lại. */
export function patchOneLine(l: LineState, p: Partial<LineState>): LineState {
  if (p.suggested && l.product_id) return l;
  if (p.name !== undefined && l.suggested)
    return { ...l, ...p, product_id: "", component_id: "", suggested: false };
  return { ...l, ...p };
}

/** Mỗi dòng có tên ⇒ id SP: chọn sẵn thì dùng, "tạo mới" thì tạo SP từ dòng trước (HĐ Mua: NCC chính = đối tác). */
export async function productIdsOf(f: FormState): Promise<(string | null)[]> {
  const ids: (string | null)[] = [];
  for (const l of f.items.filter((x) => x.name.trim())) {
    if (l.product_id !== NEW_PRODUCT) {
      ids.push(l.product_id || null);
      continue;
    }
    const supplier =
      f.deal === "buy"
        ? { main_supplier: { name: f.partner_name.trim(), tax_id: orNull(f.partner_tax_id) } }
        : {};
    const p = await createProduct({
      name: l.new_name.trim(),
      unit: orNull(l.unit),
      group: f.deal === "referral" ? "referral" : l.new_group,
      ...supplier,
    });
    ids.push(p.id);
  }
  return ids;
}

export function useContractForm() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(EMPTY_FORM);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const set = useCallback((k: TextKey, v: string) => setF((s) => ({ ...s, [k]: v })), []);
  const setDeal = useCallback((deal: ContractDeal) => {
    // Giới thiệu chỉ gắn SP nhóm Giới thiệu (5.5c): đổi loại ⇒ bỏ các lựa chọn SP đã chọn để chọn lại theo loại mới.
    setF((s) => ({
      ...s,
      deal,
      items: s.items.map((l) => ({ ...l, product_id: "", component_id: "", suggested: false })),
    }));
  }, []);
  const patchLine = useCallback(
    (i: number, p: Partial<LineState>) =>
      setF((s) => ({ ...s, items: s.items.map((l, j) => (j === i ? patchOneLine(l, p) : l)) })),
    [],
  );
  const addLine = useCallback(
    () => setF((s) => ({ ...s, items: [...s.items, { ...EMPTY_LINE }] })),
    [],
  );
  const removeLine = useCallback(
    (i: number) => setF((s) => ({ ...s, items: s.items.filter((_, j) => j !== i) })),
    [],
  );

  /** Lỗi chặn lưu (số không đọc được / thiếu ô bắt buộc / dòng chưa gắn SP) ⇒ câu báo; ổn ⇒ null. */
  function blocker(): string | null {
    const n = readNumbers(f);
    if (n.bad.length) {
      const names = n.bad.map((b) => t(`contracts.cform.bad.${b.key}`, { name: b.name }));
      return t("contracts.cform.badNumbers", { list: names.join(", ") });
    }
    setTried(true);
    const role = t(`contracts.cform.partnerRole.${PARTNER_ROLE[f.deal]}`);
    const parts = [
      ...missingRequired(f).map((k) => t(`contracts.cform.required.${k}`, { role })),
      ...unlinkedLines(f).map((i) =>
        t("contracts.cform.lineUnlinked", { name: f.items[i]?.name.trim() }),
      ),
    ];
    if (!parts.length) return null;
    const msg = t("contracts.cform.missing", { list: parts.join(", ") });
    toast(msg, "late");
    return msg;
  }

  async function submit() {
    setErr(null);
    const stop = blocker();
    if (stop) return setErr(stop);
    setBusy(true);
    try {
      const rec = await createManualContract(toRequest(f, readNumbers(f), await productIdsOf(f)));
      await qc.invalidateQueries();
      toast(t("contracts.cform.saved"));
      await nav({ to: "/contracts/$id", params: { id: rec.id } });
    } catch (x) {
      setErr(saveErrorText(x, t));
    } finally {
      setBusy(false);
    }
  }

  return {
    f,
    set,
    setDeal,
    patchLine,
    addLine,
    removeLine,
    invalid,
    unlinked,
    err,
    busy,
    submit,
    products: products.data ?? [],
  };
}
