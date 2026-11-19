// CR-189 · thuộc tính xyflow cố định của sơ đồ tổ chức (thuần, có test). Thẻ KHÔNG chọn/kéo/nối được, nhưng phần tử bên trong thẻ
// (nút tên, hàng avatar, «+», «⋯») phải nhận chuột: xyflow chỉ để `pointer-events: all` cho node khi node chọn/kéo được HOẶC chart có
// `onNodeClick` — nếu không `react-flow__pane` nuốt chuột. Hàm rỗng ở `onNodeClick` chỉ để bật `pointer-events`; nền vẫn kéo, vẫn phóng to.
const ENABLE_NODE_POINTER_EVENTS = () => {};

export const ORG_FLOW_PROPS = {
  nodesDraggable: false,
  nodesConnectable: false,
  edgesFocusable: false,
  elementsSelectable: false,
  onNodeClick: ENABLE_NODE_POINTER_EVENTS,
  panOnDrag: true,
  zoomOnScroll: true,
  zoomOnPinch: true,
} as const;
