// V2-H · BA 5.8: số ngày "Nhắc trước khi hết hạn" mặc định từ Cài đặt (`GET /business-settings`); lỗi đọc ⇒ 60 (mặc định BA).
// `undefined` = đang tải (form chưa điền).
import { RENEWAL_NOTICE_DEFAULT } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { BUSINESS_SETTINGS_KEY, fetchBusinessSettings } from "~/features/products/api";

export function useNoticeDefault(enabled = true): number | undefined {
  const q = useQuery({
    queryKey: BUSINESS_SETTINGS_KEY,
    queryFn: ({ signal }) => fetchBusinessSettings(signal),
    staleTime: 300_000,
    enabled,
  });
  return q.data?.renewal_notice_days ?? (q.isError ? RENEWAL_NOTICE_DEFAULT : undefined);
}
