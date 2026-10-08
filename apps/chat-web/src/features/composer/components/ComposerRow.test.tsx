// X2a RV1 #1 · attachments=false ⇒ không gắn handler thả tệp (không gọi `add`).
import { describe, expect, test } from "bun:test";
import { type RowAttach, rowDropProps } from "./ComposerRow";

describe("rowDropProps", () => {
  test("RV2 N7: tắt đính kèm: chặn mặc định dragover/drop, không thêm tệp", () => {
    const p = rowDropProps(null);
    let prevented = 0;
    const ev = {
      preventDefault: () => prevented++,
      dataTransfer: { files: [new File([""], "a")] },
    };
    p.onDragOver(ev as never);
    p.onDrop(ev as never);
    expect(prevented).toBe(2);
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
