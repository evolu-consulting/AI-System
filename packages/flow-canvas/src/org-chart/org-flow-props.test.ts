// CR-189 · sơ đồ tổ chức: nút/avatar/«+»/«⋯»/tên trong thẻ PHẢI nhận chuột. xyflow đặt `pointer-events: none` cho node khi chart không cho
// chọn, không kéo và không có `onNodeClick` (lớp `react-flow__pane` che mất) — nên thẻ cần `onNodeClick`, mà vẫn kéo nền + phóng to.
import { describe, expect, test } from "bun:test";
import { ORG_FLOW_PROPS } from "./org-flow-props";

describe("thuộc tính xyflow của sơ đồ tổ chức", () => {
  test("thẻ nhận chuột (có onNodeClick) nhưng không chọn/kéo/nối thẻ", () => {
    expect(typeof ORG_FLOW_PROPS.onNodeClick).toBe("function");
    expect(ORG_FLOW_PROPS.nodesDraggable).toBe(false);
    expect(ORG_FLOW_PROPS.nodesConnectable).toBe(false);
    expect(ORG_FLOW_PROPS.elementsSelectable).toBe(false);
  });
  test("vẫn kéo nền và phóng to bằng lăn chuột/chụm", () => {
    expect(ORG_FLOW_PROPS.panOnDrag).not.toBe(false);
    expect(ORG_FLOW_PROPS.zoomOnScroll).not.toBe(false);
    expect(ORG_FLOW_PROPS.zoomOnPinch).not.toBe(false);
  });
});
