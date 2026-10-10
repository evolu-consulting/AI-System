// CR-056 · P-a plan-frontend-thread §3: tin `sender_type="process"` — rẽ theo `process.kind` (7 loại), mỗi loại nạp lười.
// `process` vắng/hỏng (BE bỏ, giữ `content`) ⇒ một dòng chữ `content`. Chủ: Bước 0 (switch); thân từng loại do PF1/PF2.
import type { RoomMessage } from "@ai/contracts/chat";
import { lazy, memo, Suspense } from "react";

const ProcessBlock = lazy(() =>
  import("../../run-block/components/ProcessBlock").then((m) => ({ default: m.ProcessBlock })),
);
const OutputMessage = lazy(() =>
  import("../../run-block/components/OutputMessage").then((m) => ({ default: m.OutputMessage })),
);
const DecisionMessage = lazy(() =>
  import("../../run-block/components/DecisionMessage").then((m) => ({
    default: m.DecisionMessage,
  })),
);
const TaskResultMessage = lazy(() =>
  import("../../run-block/components/TaskResultMessage").then((m) => ({
    default: m.TaskResultMessage,
  })),
);
const RunEndMessage = lazy(() =>
  import("../../run-block/components/RunEndMessage").then((m) => ({ default: m.RunEndMessage })),
);
const AskMessage = lazy(() =>
  import("../../ask/components/AskMessage").then((m) => ({ default: m.AskMessage })),
);
const ForwardMessage = lazy(() =>
  import("../../ask/components/ForwardMessage").then((m) => ({ default: m.ForwardMessage })),
);

type Props = { message: RoomMessage; roomId: string; myId: string };

function Switch({ message, roomId, myId }: Props) {
  const part = message.process;
  const common = { message, roomId, myId };
  switch (part?.kind) {
    case "block":
      return <ProcessBlock {...common} part={part} inThread />;
    case "output":
      return <OutputMessage {...common} part={part} />;
    case "ask":
      return <AskMessage {...common} part={part} />;
    case "decision":
      return <DecisionMessage {...common} part={part} />;
    case "task_result":
      return <TaskResultMessage {...common} part={part} />;
    case "forward":
      return <ForwardMessage {...common} part={part} />;
    case "run_end":
      return <RunEndMessage {...common} part={part} />;
    default:
      return (
        <p data-seq={message.seq} className="py-1 text-sm text-secondary-foreground">
          {message.content}
        </p>
      );
  }
}

export const ProcessThreadMessage = memo(function ProcessThreadMessage(p: Props) {
  return (
    <Suspense fallback={null}>
      <Switch {...p} />
    </Suspense>
  );
});
