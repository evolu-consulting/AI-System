// X2a RV1 #1 · attachments=false ⇒ không gắn handler thả tệp (không gọi `add`).
import { describe, expect, test } from "bun:test";
import { type RowAttach, rowDropProps } from "./ComposerRow";

describe("rowDropProps", () => {
  test("tắt đính kèm: không có onDrop/onDragOver", () => {
    expect(rowDropProps(null)).toEqual({});
  });
  test("bật: trả đúng dropProps, thả tệp gọi add", () => {
    const added: File[][] = [];
    const attach: RowAttach = {
      add: (f) => added.push(f),
      dropProps: { onDragOver: () => {}, onDrop: () => added.push([]) },
    };
    const p = rowDropProps(attach) as RowAttach["dropProps"];
    p.onDrop({} as never);
    expect(added).toHaveLength(1);
    expect(rowDropProps(attach)).toBe(attach.dropProps);
  });
});
