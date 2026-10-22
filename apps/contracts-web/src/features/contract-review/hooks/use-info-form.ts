// V2-F · HD-09 · S05 + V2-G · HD-02/HD-08: trạng thái form của HĐ đã lưu.
// - Thường: bản nháp "Thông tin" từ chi tiết, chỉ PATCH ô đã đổi (khoá `version`).
// - Bước xác nhận sau khi AI đọc (`needs_review`): form dùng chung điền sẵn + dòng hàng AI đọc (kèm gợi ý SP) + mốc AI tìm thấy; "Lưu" = MỘT
//   `POST /review` (trường, loại HĐ, dòng, mốc); "Hủy" = trả về giá trị đã đọc, KHÔNG gửi gì. "Xác nhận" (HD3) lưu trước rồi quyết cấp 1.
import type { ContractDeal, ContractDetail } from "@ai/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { todayIso } from "~/features/contract-deadline/lib/deadline";
import { fetchProducts, matchProduct, PRODUCTS_KEY } from "~/features/contract-form/api";
import { patchOneLine, productIdsOf } from "~/features/contract-form/hooks/use-contract-form";
import { useNoticeDefault } from "~/features/contract-form/hooks/use-notice-default";
import { blockerMessage } from "~/features/contract-form/lib/blocker";
import { formOfDetail, patchOfForm } from "~/features/contract-form/lib/detail-form";
import {
  EMPTY_LINE,
  type FormState,
  type LineState,
  missingRequired,
  type RequiredKey,
  readNumbers,
  type TextKey,
  unlinkedLines,
  withNoticeDefault,
} from "~/features/contract-form/lib/form-model";
import {
  dealUnsure,
  formOfConfirm,
  type MsRow,
  msRowsOf,
  reviewRequest,
  switchDeal,
  unsureKeys,
} from "~/features/contract-form/lib/review-model";
import { suggestionPatch } from "~/features/contract-form/lib/suggest";
import { contractKey, patchContractFields, saveReview } from "../api";
import { savedNoticeKey } from "../lib/review";
import { saveErrorText } from "../lib/save-error";

const SUGGEST_MAX = 50;

type SetF = Dispatch<SetStateAction<FormState | null>>;

/** Nạp form + mốc từ HĐ; `sug` tăng mỗi lần nạp lại / đổi loại (kích hoạt gợi ý SP + điền lại nhắc trước). */
function useInfoLoad(c: ContractDetail | undefined, confirm: boolean) {
  const [f, setF] = useState<FormState | null>(null);
  const [rows, setRows] = useState<MsRow[]>([]);
  const [tried, setTried] = useState(false);
  const [sug, setSug] = useState(0);
  const load = useCallback(() => {
    if (!c) return;
    setF(c.status === "needs_review" && c.ai !== null ? formOfConfirm(c) : formOfDetail(c));
    setRows(msRowsOf(c));
    setTried(false);
    setSug((n) => n + 1);
  }, [c]);
  useEffect(load, [load]);
  // V2-H · BA 5.8: bước xác nhận — HĐ không ghi điều khoản báo trước ⇒ "Nhắc trước khi hết hạn" điền sẵn từ Cài đặt.
  const notice = useNoticeDefault(confirm);
  // biome-ignore lint/correctness/useExhaustiveDependencies: điền lại sau mỗi lần nạp form (`sug` đổi khi tải lại)
  useEffect(() => {
    if (confirm) setF((s) => (s ? withNoticeDefault(s, notice) : s));
  }, [confirm, notice, sug]);
  return { f, setF, rows, setRows, tried, setTried, sug, setSug, load };
}

/** Gợi ý SP cho dòng chưa gắn (quy tắc nhận diện ⇒ trùng từ ⇒ "Tạo sản phẩm mới" + thành phần): song song, tối đa 50 dòng. */
function useProductSuggest(confirm: boolean, f: FormState | null, setF: SetF, sug: number) {
  const fRef = useRef(f);
  fRef.current = f;
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi `sug` đổi (tải lại / đổi loại)
  useEffect(() => {
    const f0 = fRef.current;
    if (!confirm || !f0) return;
    const todo = f0.items
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !l.product_id && l.name.trim().length >= 2)
      .slice(0, SUGGEST_MAX);
    let live = true;
    for (const { l, i } of todo)
      matchProduct(l.name.trim(), f0.deal)
        .then((r) => {
          const p = suggestionPatch(r, f0.deal);
          if (!live || !p) return;
          setF((s) =>
            s ? { ...s, items: s.items.map((x, j) => (j === i ? patchOneLine(x, p) : x)) } : s,
          );
        })
        .catch(() => undefined); // gợi ý là phụ: lỗi mạng ⇒ người dùng tự chọn
    return () => {
      live = false;
    };
  }, [sug]);
}

type Load = ReturnType<typeof useInfoLoad>;

/** Các thao tác sửa form / mốc (ổn định tham chiếu). */
function useInfoEditors(c: ContractDetail | undefined, L: Load) {
  const { setF, setRows, setSug } = L;
  const set = useCallback(
    (k: TextKey, v: string) => setF((s) => (s ? { ...s, [k]: v } : s)),
    [setF],
  );
  const setDeal = useCallback(
    (d: ContractDeal) => {
      if (!c) return;
      setF((s) => (s ? switchDeal(c, s, d) : s));
      setSug((n) => n + 1);
    },
    [c, setF, setSug],
  );
  const patchLine = useCallback(
    (i: number, p: Partial<LineState>) =>
      setF((s) =>
        s ? { ...s, items: s.items.map((l, j) => (j === i ? patchOneLine(l, p) : l)) } : s,
      ),
    [setF],
  );
  const addLine = useCallback(
    () => setF((s) => (s ? { ...s, items: [...s.items, { ...EMPTY_LINE }] } : s)),
    [setF],
  );
  const removeLine = useCallback(
    (i: number) => setF((s) => (s ? { ...s, items: s.items.filter((_, j) => j !== i) } : s)),
    [setF],
  );
  const setRow = useCallback(
    (i: number, p: Partial<MsRow>) =>
      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r))),
    [setRows],
  );
  return { set, setDeal, patchLine, addLine, removeLine, setRow };
}

/** Tập ô lỗi / dòng chưa gắn / ô AI chưa chắc, suy ra từ form. */
function useInfoDerived(
  c: ContractDetail | undefined,
  f: FormState | null,
  tried: boolean,
  confirm: boolean,
) {
  const unlinked = useMemo<Set<number>>(
    () => (tried && f ? new Set(unlinkedLines(f)) : new Set()),
    [tried, f],
  );
  const invalid = useMemo<Set<RequiredKey>>(
    () => (tried && f && confirm ? new Set(missingRequired(f)) : new Set()),
    [tried, f, confirm],
  );
  const unsure = useMemo(
    () => (c && f && confirm ? unsureKeys(c, f) : new Set<TextKey>()),
    [c, f, confirm],
  );
  const dealIsUnsure = !!c && !!f && confirm && dealUnsure(c, f);
  return { unlinked, invalid, unsure, dealUnsure: dealIsUnsure };
}

type SaveCtx = { c: ContractDetail | undefined; id: string; confirm: boolean; f: FormState | null };

/** Lưu ở bước xác nhận: tạo SP mới (nếu chọn) rồi MỘT `POST /review`; chặn lỗi ⇒ toast + ném. */
function useSaveConfirm(x: SaveCtx, rows: MsRow[], setTried: (v: boolean) => void) {
  const { t } = useTranslation();
  const { c, f, id } = x;
  return useCallback(async () => {
    if (!c || !f) return null;
    const stop = blockerMessage(f, t, () => setTried(true));
    if (stop) {
      toast(stop, "late");
      throw new Error(stop);
    }
    const productIds = await productIdsOf(f);
    return saveReview(
      id,
      reviewRequest({ c, f, n: readNumbers(f), productIds, rows, today: todayIso() }),
    );
  }, [c, f, rows, id, t, setTried]);
}

/** Lưu + trạng thái (busy/msg/err) + hủy. `saveFirst` chỉ ghi khi có gì để ghi (luồng "Xác nhận"). */
function useInfoSave(x: SaveCtx, L: Load, patch: Record<string, unknown>) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { c, id, confirm } = x;
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saveConfirm = useSaveConfirm(x, L.rows, L.setTried);
  const reset = useCallback(() => {
    L.load();
    setErr(null);
    setMsg(null);
  }, [L.load]);
  const saveFirst = useCallback(async () => {
    if (confirm) await saveConfirm();
    else if (c && Object.keys(patch).length) await patchContractFields(id, c.version, patch);
  }, [confirm, saveConfirm, c, patch, id]);
  const save = useCallback(async () => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      if (confirm) {
        const out = await saveConfirm();
        await qc.invalidateQueries({ queryKey: contractKey(id) });
        await qc.invalidateQueries({ queryKey: ["contracts", "list"] });
        const m = t(savedNoticeKey(out?.status ?? "needs_review", out?.status === "active"));
        toast(m);
        setMsg(m);
      } else {
        await saveFirst();
        await qc.invalidateQueries({ queryKey: contractKey(id) });
        setMsg(t(savedNoticeKey(c?.status ?? "", false)));
      }
    } catch (e) {
      setErr(e instanceof Error && !("status" in e) ? e.message : saveErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }, [confirm, saveConfirm, saveFirst, qc, id, t, c?.status]);
  return { reset, save, saveFirst, busy, msg, err };
}

export function useInfoForm(c: ContractDetail | undefined, id: string) {
  // Màn xác nhận sau AI đọc = chờ xác nhận + có phần AI đọc (`ai`); HĐ nhập tay / bản đọc cũ (ai = null) giữ luồng PATCH của V2-F.
  const confirm = c?.status === "needs_review" && c.ai !== null;
  const L = useInfoLoad(c, confirm);
  const products = useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: ({ signal }) => fetchProducts(signal),
    staleTime: 60_000,
    enabled: !!c,
  });
  useProductSuggest(confirm, L.f, L.setF, L.sug);
  const patch = useMemo(() => (c && L.f && !confirm ? patchOfForm(c, L.f) : {}), [c, L.f, confirm]);
  const dirty = confirm ? true : Object.keys(patch).length > 0;
  const editors = useInfoEditors(c, L);
  const derived = useInfoDerived(c, L.f, L.tried, confirm);
  const saving = useInfoSave({ c, id, confirm, f: L.f }, L, patch);
  return {
    f: L.f,
    ...editors,
    rows: L.rows,
    confirm,
    ...derived,
    products: products.data ?? [],
    dirty,
    ...saving,
  };
}
