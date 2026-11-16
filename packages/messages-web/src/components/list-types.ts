// CR-169 · lát 6 · kiểu props của danh sách hội thoại (tách khỏi `ConversationList.tsx` để các phần con không import vòng).
import type { ConversationSummary, MsgCompany, MsgPerson } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import type { ReactNode } from "react";

export type ConversationListProps = {
  items: readonly ConversationSummary[];
  people: readonly MsgPerson[];
  /** Thẻ người đã đọc theo lô (avatar, phòng ban) — chỉ đồng nghiệp cùng công ty. */
  cards: ReadonlyMap<string, PersonCard>;
  /** Ô tìm do cha giữ (lọc ở server cho danh bạ). */
  q: string;
  onQ: (q: string) => void;
  peopleStatus: "loading" | "error" | "ready";
  peopleHasMore: boolean;
  peopleLoadingMore: boolean;
  onMorePeople: () => void;
  myId: string;
  activeId: string | null;
  status: "loading" | "error" | "ready";
  hasMore: boolean;
  loadingMore: boolean;
  /** Người đang được mở 1-1 (khoá dòng trong lúc tạo). */
  openingId: string | null;
  /** Tab đang chọn (để chọn câu rỗng) và công ty đối tác đang lọc (tên trong câu rỗng). */
  tab: "all" | "unread" | "partner";
  /** Thanh «Tất cả · Chưa đọc · Đối tác ▾» (do cha nối dữ liệu). */
  filterBar: ReactNode;
  company: MsgCompany | null;
  onSelect: (id: string) => void;
  onPickPerson: (userId: string, company?: MsgCompany) => void;
  onNew: () => void;
  onMore: () => void;
  onRetry: () => void;
  /** CR-178 · M3 · nội dung tab «Tin nhắn» khi đang tìm (kết quả tìm tin, đã nối dữ liệu); không có ⇒ chỉ tìm người/cuộc như cũ. */
  messageSearch?: ReactNode;
};
