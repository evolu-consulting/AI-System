// ADM-FR-71 · P-b2: điểm nối vô hình của node (xyflow cần Handle để vẽ cạnh; không nối tay — `nodesConnectable=false`).
import { Handle, type HandleProps } from "@xyflow/react";

const HIDDEN = {
  opacity: 0,
  pointerEvents: "none",
  minWidth: 0,
  minHeight: 0,
  width: 1,
  height: 1,
} as const;

export function HiddenHandle(p: Omit<HandleProps, "isConnectable" | "style">) {
  return <Handle {...p} isConnectable={false} style={HIDDEN} />;
}
