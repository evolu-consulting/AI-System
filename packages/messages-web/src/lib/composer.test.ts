// CR-178 · M2 · test hàm thuần của ô soạn.
import { describe, expect, test } from "bun:test";
import {
  dragHasFiles,
  droppedFiles,
  insertAtCursor,
  loadRecent,
  loadSkin,
  pastedFiles,
  pushRecent,
  saveRecent,
} from "./composer";

const png = new File([new Uint8Array(4)], "image.png", { type: "image/png" });

describe("insertAtCursor", () => {
  test("chèn giữa chữ, con trỏ sau emoji", () => {
    expect(insertAtCursor("ab", 1, 1, "😀", 100)).toEqual({ text: "a😀b", caret: 3 });
  });
  test("thay vùng chọn", () => {
    expect(insertAtCursor("abcd", 1, 3, "🙂", 100)).toEqual({ text: "a🙂d", caret: 3 });
  });
  test("vị trí ngoài biên được kẹp; vượt giới hạn ⇒ null", () => {
    expect(insertAtCursor("ab", 9, 9, "x", 100)).toEqual({ text: "abx", caret: 3 });
    expect(insertAtCursor("abc", 3, 3, "😀", 4)).toBeNull();
  });
});

describe("tệp từ dán / kéo thả", () => {
  test("ảnh chụp màn hình (không có chữ) ⇒ lấy tệp", () => {
    expect(pastedFiles({ files: [png], types: ["Files"] })).toEqual([png]);
  });
  test("dán chữ thường ⇒ rỗng", () => {
    expect(pastedFiles({ files: [], types: ["text/plain"], getData: () => "xin chào" })).toEqual(
      [],
    );
    expect(pastedFiles(null)).toEqual([]);
  });
  test("vừa có ảnh vừa có chữ ⇒ coi là dán chữ", () => {
    expect(
      pastedFiles({ files: [png], types: ["text/plain", "Files"], getData: () => "a\tb" }),
    ).toEqual([]);
  });
  test("kéo: chỉ nhận khi có tệp", () => {
    expect(dragHasFiles({ types: ["Files"] })).toBe(true);
    expect(dragHasFiles({ types: ["text/plain"] })).toBe(false);
    expect(droppedFiles({ files: [png] })).toEqual([png]);
  });
});

describe("dùng gần đây", () => {
  test("đưa lên đầu, bỏ trùng, tối đa N", () => {
    expect(pushRecent(["a", "b", "c"], "b", 3)).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
  test("lưu/đọc qua kho giả; kho lỗi ⇒ không ném", () => {
    const mem: Record<string, string> = {};
    const store = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
    };
    saveRecent(["😀", "👍"], store);
    expect(loadRecent(store)).toEqual(["😀", "👍"]);
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadRecent(bad)).toEqual([]);
    expect(loadSkin(bad)).toBe("none");
    expect(() => saveRecent(["x"], bad)).not.toThrow();
    expect(loadRecent({ getItem: () => "không phải json" })).toEqual([]);
  });
});
