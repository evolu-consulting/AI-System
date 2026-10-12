// HUB-FR-44 · X2b-2 D6/D7
import { describe, expect, test } from "bun:test";
import { attachNoteOf, joinDescribedBy } from "./AttachNote";

const note = { share: "S", needText: "N" };
describe("attachNoteOf", () => {
  test("không tệp / không prop ⇒ null", () => {
    expect(attachNoteOf(note, 0, "hi")).toBeNull();
    expect(attachNoteOf(undefined, 2, "hi")).toBeNull();
  });
  test("có tệp: thiếu chữ ⇒ needText + share, có chữ ⇒ share", () => {
    expect(attachNoteOf(note, 1, "  ")).toEqual(["N", "S"]);
    expect(attachNoteOf(note, 1, "hi")).toEqual(["S"]);
  });
  test("joinDescribedBy bỏ phần vắng", () => {
    expect(joinDescribedBy(false, undefined)).toBeUndefined();
    expect(joinDescribedBy("a", false, "b")).toBe("a b");
  });
});
