// V2-G · HD-04: dòng SP của HĐ đã lưu — giữ lựa chọn SP cục bộ, lưu ngay khi đổi (`PUT /contracts/:id/items/:itemId/product`);
// lỗi ⇒ trả về giá trị đã lưu; 409 `ITEM_LOCKED` ⇒ câu riêng.
import type { ContractItem } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { fetchProducts, PRODUCTS_KEY } from "~/features/contract-form/api";
import type { LineState } from "~/features/contract-form/lib/form-model";
import { lineOfItem } from "~/features/contract-form/lib/review-model";
import { contractKey, putItemProduct } from "../api";
import { saveErrorText } from "../lib/save-error";

export function useSavedItem(
  it: ContractItem,
  contractId: string,
  onError: (m: string | null) => void,
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const products = useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: ({ signal }) => fetchProducts(signal),
    staleTime: 60_000,
  });
  const [line, setLine] = useState<LineState>(() => lineOfItem(it));
  const onPatch = async (p: Partial<LineState>) => {
    const next = { ...line, ...p };
    if (next.product_id === line.product_id && next.component_id === line.component_id) return;
    setLine(next);
    onError(null);
    try {
      await putItemProduct(contractId, it.id, {
        product_id: next.product_id || null,
        ...(next.product_id && next.component_id ? { component_ids: [next.component_id] } : {}),
      });
      toast(t("contracts.cdetail.attachSaved"));
      await qc.invalidateQueries({ queryKey: contractKey(contractId) });
    } catch (e) {
      setLine(line);
      onError(
        e instanceof ApiError && e.status === 409
          ? t("contracts.cdetail.itemLocked")
          : saveErrorText(e, t),
      );
    }
  };
  return { line, products: products.data ?? [], onPatch };
}
