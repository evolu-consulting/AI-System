// CR-169 · lát 6 · kiểu props của danh sách hội thoại (tách khỏi `ConversationList.tsx` để các phần con không import vòng).
// CR-190 · cột trái chỉ còn bố cục (ô tìm, «Tất cả/Chưa đọc», thân); thân (danh bạ nhóm hoặc cuộc chưa đọc) do cha dựng sẵn.
import type { ReactNode } from "react";
import type { ListTab } from "./ListFilter";

export type ConversationListProps = {
  /** Ô tìm do cha giữ (lọc ở máy chủ cho danh bạ). */
  q: string;
  onQ: (q: string) => void;
  tab: ListTab;
  onTab: (tab: ListTab) => void;
  /** Tổng chưa đọc (số cạnh «Chưa đọc»). */
  unreadTotal: number;
  /** Trạng thái tải của thân đang xem; `ready` khi đã có dữ liệu (kể cả dữ liệu cũ đang làm mới). */
  status: "loading" | "error" | "ready";
  /** Đổi «Chưa đọc»/«Tất cả» mà dữ liệu mới chưa về ⇒ giữ thân cũ, làm mờ (không nháy trống). */
  fading: boolean;
  /** Thân: danh bạ nhóm hoặc danh sách chưa đọc (đã nối dữ liệu). */
  main: ReactNode;
  /** CR-178 · M3 · nội dung tab «Tin nhắn» khi đang tìm (kết quả tìm tin, đã nối dữ liệu); không có ⇒ chỉ tìm người/nhóm/công ty. */
  messageSearch?: ReactNode;
  onNew: () => void;
  onRetry: () => void;
};
