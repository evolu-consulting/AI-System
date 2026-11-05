// V2-L · nạp 2 nguồn cài đặt (công ty · điểm kinh doanh) thành một trạng thái (đã lưu + mặc định) và áp nhận diện công ty lên cả app.
import type { BizPreviewIn } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { applyTheme, ownTheme } from "~/features/shell/lib/theme";
import { fetchBizConfig, fetchCompany, previewBiz, saveChanged, settingsKeys } from "../api";
import { applyBrandDom, type Brand, brandStore, effectiveTheme, useBrand } from "../lib/brand";
import { buildState, type Changed } from "../lib/data";
import type { SettingsData } from "../lib/types";

export const brandOf = (c: {
  name: string | null;
  app_name: string | null;
  logo: string | null;
  accent: Brand["accent"];
  theme: Brand["theme"];
}): Brand => ({
  name: c.name,
  app_name: c.app_name,
  logo: c.logo,
  accent: c.accent,
  theme: c.theme,
});

/** Trong Shell: công ty đã lưu ⇒ kho nhận diện; màu/giao diện/tiêu đề tab áp ngay khi kho đổi (kể cả bản xem thử của hộp thoại). */
export function useBrandSync(): void {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: settingsKeys.company,
    queryFn: ({ signal }) => fetchCompany(signal),
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (q.data) brandStore.setSaved(brandOf(q.data.company));
  }, [q.data]);
  const b = useBrand();
  useEffect(() => {
    applyBrandDom(b, b.app_name ?? t("contracts.app.name"));
    applyTheme(effectiveTheme(b, brandStore.isPreview(), ownTheme()));
  }, [b, t]);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia("(prefers-color-scheme: dark)");
    const on = () =>
      applyTheme(effectiveTheme(brandStore.get(), brandStore.isPreview(), ownTheme()));
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
}

/** Chỉ khi hộp thoại mở: đủ 2 nguồn mới có trạng thái. */
export function useSettingsState(enabled: boolean) {
  const o = { enabled, retry: false, staleTime: 0, refetchOnWindowFocus: false } as const;
  const co = useQuery({
    queryKey: settingsKeys.company,
    queryFn: ({ signal }) => fetchCompany(signal),
    ...o,
  });
  const biz = useQuery({
    queryKey: settingsKeys.biz,
    queryFn: ({ signal }) => fetchBizConfig(signal),
    ...o,
  });
  const state = useMemo(
    () => (co.data && biz.data ? buildState(co.data, biz.data) : null),
    [co.data, biz.data],
  );
  return {
    state,
    loading: co.isPending || biz.isPending,
    error: co.isError || biz.isError,
    retry: () => {
      void co.refetch();
      void biz.refetch();
    },
  };
}

/** Thử tính điểm kinh doanh trên mẫu nhập tay. */
export function useBizPreview(body: BizPreviewIn) {
  return useQuery({
    queryKey: ["settings", "biz-preview", JSON.stringify(body)],
    queryFn: ({ signal }) => previewBiz(body, signal),
    staleTime: 30_000,
    retry: false,
  });
}

/** Lưu phần đã đổi; luôn làm mới mọi truy vấn khi xong. Lỗi API ⇒ message của lỗi (nếu có). */
export function useSaveSettings() {
  const qc = useQueryClient();
  return async (draft: SettingsData, parts: Changed) => {
    try {
      await saveChanged(draft, parts);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, message: e instanceof ApiError ? e.message : undefined };
    } finally {
      void qc.invalidateQueries();
    }
  };
}
