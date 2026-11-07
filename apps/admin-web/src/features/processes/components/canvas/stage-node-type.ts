// Kiểu dữ liệu của node giai đoạn trên canvas — tách khỏi `StageNode` để `StageNode` ⇄ `ModuleNode` không vòng import.
import type { Node } from "@xyflow/react";
import type { StageView } from "./stage-view";

export type StageNodeData = {
  v: StageView;
  selected: boolean;
  readOnly: boolean;
  /** CR-122 · p22 · hiện cổng ra để kéo nối tay. */
  connectable?: boolean;
};
export type StageNodeType = Node<StageNodeData, "stage">;
