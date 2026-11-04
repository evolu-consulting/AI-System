import { describe, expect, test } from "bun:test";
import { interactionOf } from "./mode";

describe("mode canvas", () => {
  test("mode view khoá kéo/nối/chọn, edit chỉ mở kéo", () => {
    const hooks = { onConnect: () => {}, onNodeClick: () => {} };
    expect(interactionOf("view", hooks)).toEqual({
      nodesDraggable: false,
      nodesConnectable: false,
      elementsSelectable: false,
    });
    // edit không móc ⇒ chỉ kéo (như editor admin: nối/chọn do host tự lo)
    expect(interactionOf("edit")).toEqual({
      nodesDraggable: true,
      nodesConnectable: false,
      elementsSelectable: false,
    });
    // edit + móc của host ⇒ mở nối/chọn
    expect(interactionOf("edit", hooks)).toEqual({
      nodesDraggable: true,
      nodesConnectable: true,
      elementsSelectable: true,
    });
  });
});
