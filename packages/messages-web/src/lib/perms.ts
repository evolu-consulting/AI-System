// CR-132 · W2 · luật hiện nút theo vai (spec CR-132 §7). Server vẫn là nơi quyết định; đây chỉ để không hiện nút chắc chắn bị từ chối.
import type { ConversationDetail, Message } from "@ai/contracts/pack-contracts";

type Conv = Pick<ConversationDetail, "kind" | "my_role" | "peer">;

/** Đổi tên, thêm người: chủ nhóm; 1-1 cố định. */
export const canManage = (c: Pick<Conv, "kind" | "my_role">): boolean =>
  c.kind === "group" && c.my_role === "owner";
/** Bớt người: chủ, không tự bớt mình (mình dùng «Rời nhóm»). */
export const canRemoveMember = (
  c: Pick<Conv, "kind" | "my_role">,
  targetId: string,
  myId: string,
) => canManage(c) && targetId !== myId;
export const canLeave = (c: Pick<Conv, "kind">): boolean => c.kind === "group";
/** Thu hồi: chỉ tin của mình, chưa thu hồi. */
export const canRevoke = (m: Pick<Message, "sender_id" | "deleted">, myId: string): boolean =>
  m.sender_id === myId && !m.deleted;
/** 1-1 mà người kia đã khoá ⇒ khoá ô gửi. */
export const composerLocked = (c: Pick<Conv, "kind" | "peer">): boolean =>
  c.kind === "direct" && c.peer !== null && !c.peer.active;
