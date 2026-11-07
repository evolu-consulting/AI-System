// CR-125 · x6 · thẻ ký số nghe `/me/stream`: chỉ sự kiện `esign.updated` của ĐÚNG hợp đồng đang mở mới làm tải lại trạng thái.
import type { MeStreamProcessEvent } from "@ai/contracts/chat";

export const eventConcernsEsign = (e: MeStreamProcessEvent, contractId: string): boolean =>
  e.event === "esign.updated" && e.data.contract_id === contractId;

/** Tuỳ chọn truy vấn trạng thái ký số: KHÔNG poll; dự phòng = tải lại khi quay lại cửa sổ. `staleTime: 0` bắt buộc — mặc định 30 s của app làm truy vấn còn "tươi" ⇒ focus không tải lại. */
export const ESIGN_QUERY_OPTS = { retry: false, staleTime: 0, refetchOnWindowFocus: true } as const;
