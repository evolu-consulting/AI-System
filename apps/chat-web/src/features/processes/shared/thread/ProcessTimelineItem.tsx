// CR-056 · P-a thread §6 #5: tin `sender_type="process"` ở timeline chính = `ProcessBlock` (nạp lười, chỉ vào bundle khi phòng có quy trình).
// `process` vắng/hỏng ⇒ một dòng `content` (BE giữ tóm tắt).
import type { RoomMessage } from "@ai/contracts/chat";
import { lazy, Suspense } from "react";

const ProcessBlock = lazy(() =>
  import("../../run-block/components/ProcessBlock").then((m) => ({ default: m.ProcessBlock })),
);

type Props = { message: RoomMessage; myId: string; onReply?: (flowId: string) => void };

export function ProcessTimelineItem({ message, myId, onReply }: Props) {
  const part = message.process;
  if (part?.kind !== "block") {
    return <p className="py-1 text-sm text-secondary-foreground">{message.content}</p>;
  }
  return (
    <Suspense fallback={null}>
      <ProcessBlock
        message={message}
        part={part}
        roomId={message.room_id}
        myId={myId}
        onReply={onReply}
      />
    </Suspense>
  );
}
