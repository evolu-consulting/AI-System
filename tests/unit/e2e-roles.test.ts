// pl-e2e-roles · guard G3 của e2e/_roles.ts
import { describe, expect, it } from "bun:test";
import { assertDistinctActors } from "../../e2e/_roles";

describe("assertDistinctActors", () => {
  it("ba người khác nhau ⇒ qua", () => {
    expect(() =>
      assertDistinctActors("Chọn đối tác", { creator: "nv", actor: "gd", dataOwner: "kt" }),
    ).not.toThrow();
  });
  it("người làm bước = người thêm dữ liệu ⇒ ném, nêu tên bước", () => {
    expect(() =>
      assertDistinctActors("Chọn đối tác", { creator: "nv", actor: "gd", dataOwner: "gd" }),
    ).toThrow(/Chọn đối tác.*người thêm dữ liệu/);
  });
  it("người làm bước = người tạo bản ghi ⇒ ném", () => {
    expect(() =>
      assertDistinctActors("Chọn đối tác", { creator: "gd", actor: "gd", dataOwner: "kt" }),
    ).toThrow(/người tạo bản ghi/);
  });
});
