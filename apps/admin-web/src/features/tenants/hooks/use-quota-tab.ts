// ADM-FR-40 · trạng thái của tab Quota: dữ liệu server, bản nháp, bẩn/sạch, lưu (toast + 409) — để component chỉ trình bày.
import type { QuotaSetResponse, TenantDetail } from "@ai/contracts";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useQuotaFeatureOptions, useTenantQuotas } from "../api";
import {
  ensureTenantRow,
  type QuotaRow,
  rowHasError,
  rowsFromResponse,
  signature,
  toItems,
} from "../lib/quota-draft";
import { useTenantQuotaSave } from "./use-tenant-quotas";

type Args = {
  tenant: TenantDetail;
  onDirtyChange: (dirty: boolean) => void;
  onReloadTenant: () => void;
};

/** Toast lỗi lưu (bỏ qua UNAUTHORIZED: phiên hết hạn đã có hộp thoại riêng). */
function useFailToast() {
  const tr = useTr();
  return (err: unknown) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
    const spec = describeError(err);
    notifyError(tr(spec.key, spec.params));
  };
}

/** Lỗi tải để hiện ErrorState; `null` khi đã có dữ liệu. */
function failure(error: unknown, baseline: QuotaRow[] | null) {
  if (!error && baseline) return null;
  const err = error instanceof ApiError ? error : null;
  return { message: err?.message ?? "", code: err?.code ?? "NETWORK_ERROR" };
}

/** Nháp ô nhập: nạp lại khi nội dung server đổi, báo bẩn/sạch lên trang (UnsavedGuard). */
function useQuotaDraft(baseline: QuotaRow[] | null, onDirtyChange: (dirty: boolean) => void) {
  const [draft, setDraft] = useState<QuotaRow[]>([]);
  const [touched, setTouched] = useState(false);
  const baseSig = baseline ? signature(baseline) : "";

  // Bản mới từ server (sau lưu / tải lại) → nạp lại nháp. Chữ ký không đổi (chỉ version) → giữ nguyên nháp.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại theo chữ ký nội dung, không theo identity của mảng
  useEffect(() => {
    if (baseline) setDraft(baseline);
    setTouched(false);
  }, [baseSig, baseline === null]);
  const dirty = baseline !== null && signature(draft) !== baseSig;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  return { draft, setDraft, touched, setTouched, dirty };
}

export function useQuotaTab({ tenant, onDirtyChange, onReloadTenant }: Args) {
  const { t, i18n } = useTranslation();
  const query = useTenantQuotas(tenant.id, true);
  const options = useQuotaFeatureOptions(tenant.id, true);
  const tenantName = t("tenants.quota.scope.tenant");
  const build = (res: QuotaSetResponse) =>
    ensureTenantRow(rowsFromResponse(res, i18n.language), tenantName);
  // biome-ignore lint/correctness/useExhaustiveDependencies: build đổi theo ngôn ngữ/tên đã liệt kê
  const baseline = useMemo(
    () => (query.data ? build(query.data) : null),
    [query.data, i18n.language, tenantName],
  );
  const { draft, setDraft, touched, setTouched, dirty } = useQuotaDraft(baseline, onDirtyChange);

  const save = useTenantQuotaSave(tenant.id, {
    onSaved: () => notifySuccess(t("tenants.toast.saved", { key: tenant.key })),
    onFail: useFailToast(),
    onReload: () => {
      onReloadTenant();
      void query.refetch().then((r) => {
        if (r.data) setDraft(build(r.data));
      });
    },
  });
  const submit = () => {
    setTouched(true);
    if (draft.some(rowHasError)) return;
    void save.save({ items: toItems(draft) }, tenant.version);
  };
  return {
    pending: query.isPending,
    failed: failure(query.error, baseline),
    refetch: () => void query.refetch(),
    month: query.data?.month ?? "",
    statuses: query.data?.items ?? [],
    options,
    draft,
    setDraft,
    reset: () => baseline && setDraft(baseline),
    touched,
    setTouched,
    dirty,
    saving: save.pending,
    conflictProps: save.props,
    submit,
  };
}
