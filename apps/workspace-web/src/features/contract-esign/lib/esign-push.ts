// CR-125 · x6 · thẻ ký số nghe `/me/stream`: chỉ sự kiện `esign.updated` của ĐÚNG hợp đồng đang mở mới làm tải lại trạng thái.
import type { MeStreamProcessEvent } from "@ai/contracts/chat";

export const eventConcernsEsign = (e: MeStreamProcessEvent, contractId: string): boolean =>
  e.event === "esign.updated" && e.data.contract_id === contractId;
