// CR-179 · dòng danh sách hội thoại 3 dòng: (1) tên người + giờ, (2) «công ty · chức vụ», (3) xem trước tin cuối.
// Hàm thuần để test; trình bày ở `components/ConversationRow.tsx`.
import type { ConversationSummary } from "@ai/contracts/pack-contracts";

/** Tên dùng cho avatar: luôn là tên người/nhóm (không dùng tên công ty — trước đây «Công ty preschool» ⇒ «CP»). */
export const avatarNameOf = (title: string): string => title;

/** Dòng 2: công ty (chỉ cuộc `partner`) và chức vụ (người kia của 1-1, nếu có). Thiếu cả hai ⇒ null (không vẽ dòng). */
export function metaLineOf(
  c: Pick<ConversationSummary, "kind" | "company" | "peer"> | null,
): { company: string; job: string } | null {
  if (!c) return null;
  const company = c.kind === "partner" ? (c.company?.name ?? "").trim() : "";
  const job = c.kind !== "group" ? (c.peer?.job_title ?? "").trim() : "";
  if (!company && !job) return null;
  return { company, job };
}
