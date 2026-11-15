// CR-169 · lát 6 · kiểu props của danh sách hội thoại (tách khỏi `ConversationList.tsx` để các phần con không import vòng).
import type { ConversationSummary, MsgCompany, MsgPerson } from "@ai/contracts/pack-contracts";
import type { PersonCard } from "@ai/contracts/people";
import type { ReactNode } from "react";
import type { CompanyFilter } from "../lib/company-filter";

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
  filter: CompanyFilter;
  /** Thanh chip lọc công ty (do cha nối dữ liệu). */
  filterBar: ReactNode;
  /** Công ty đang lọc (để nói trong câu rỗng, nút «Bảng tin»). */
  company: MsgCompany | null;
  onFeed: () => void;
  onSelect: (id: string) => void;
  onPickPerson: (userId: string, company?: MsgCompany) => void;
  onNew: () => void;
  onMore: () => void;
  onRetry: () => void;
};
