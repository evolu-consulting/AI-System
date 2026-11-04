// CR-118 · @ai/flow-canvas · chế độ canvas: `view` = chỉ xem (không kéo/nối/chọn); `edit` mở kéo, và nối/chọn CHỈ khi host cấp móc.
export type FlowMode = "view" | "edit";
export type InteractionHooks = { onConnect?: unknown; onNodeClick?: unknown };
export type Interaction = {
  nodesDraggable: boolean;
  nodesConnectable: boolean;
  elementsSelectable: boolean;
};

export function interactionOf(mode: FlowMode, hooks: InteractionHooks = {}): Interaction {
  const edit = mode === "edit";
  return {
    nodesDraggable: edit,
    nodesConnectable: edit && !!hooks.onConnect,
    elementsSelectable: edit && !!hooks.onNodeClick,
  };
}
