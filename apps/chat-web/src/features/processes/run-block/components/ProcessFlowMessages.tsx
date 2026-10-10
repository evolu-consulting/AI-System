// CR-056 · P-a Bước 0: STUB PF1 — danh sách tin của thread quy trình (`role="log"`, `useStickyScroll`).
import type { RoomMessage } from "@ai/contracts/chat";

export type ProcessFlowMessagesProps = {
  roomId: string;
  myId: string;
  messages: readonly RoomMessage[];
};

export function ProcessFlowMessages(_props: ProcessFlowMessagesProps) {
  return null;
}
