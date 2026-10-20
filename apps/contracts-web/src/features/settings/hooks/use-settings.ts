// V2-L · nạp 3 nguồn cài đặt thành một trạng thái (đã lưu + mặc định) và áp nhận diện công ty lên cả app.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { applyTheme, ownTheme } from "~/features/shell/lib/theme";
import { fetchBizConfig, fetchCompany, fetchRepConfig, settingsKeys } from "../api";
import { applyBrandDom, type Brand, brandStore, effectiveTheme, useBrand } from "../lib/brand";
import { buildState } from "../lib/data";

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

/** Chỉ khi hộp thoại mở: đủ 3 nguồn mới có trạng thái. */
export function useSettingsState(enabled: boolean) {
  const o = { enabled, retry: false, staleTime: 0, refetchOnWindowFocus: false } as const;
  const co = useQuery({
    queryKey: settingsKeys.company,
    queryFn: ({ signal }) => fetchCompany(signal),
    ...o,
  });
  const rep = useQuery({
    queryKey: settingsKeys.rep,
    queryFn: ({ signal }) => fetchRepConfig(signal),
    ...o,
  });
  const biz = useQuery({
    queryKey: settingsKeys.biz,
    queryFn: ({ signal }) => fetchBizConfig(signal),
    ...o,
  });
  const state = useMemo(
    () => (co.data && rep.data && biz.data ? buildState(co.data, rep.data, biz.data) : null),
    [co.data, rep.data, biz.data],
  );
  return {
    state,
    loading: co.isPending || rep.isPending || biz.isPending,
    error: co.isError || rep.isError || biz.isError,
    retry: () => {
      void co.refetch();
      void rep.refetch();
      void biz.refetch();
    },
  };
}
