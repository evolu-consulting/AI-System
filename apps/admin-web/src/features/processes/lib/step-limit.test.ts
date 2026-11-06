import { describe, expect, test } from "bun:test";
import { describeWhen } from "./library-list";
import { canAddStep, editorModeOf, nextVersion, stepCounter, viewModeOf } from "./step-limit";

describe("CR-121 c17b · n/20 và chặn bước thứ 21", () => {
  test("bộ đếm n/20", () => {
    expect(stepCounter(3)).toBe("3/20");
    expect(stepCounter(20)).toBe("20/20");
  });
  test("thêm được tới 20, bước 21 bị chặn", () => {
    expect(canAddStep(19)).toBe(true);
    expect(canAddStep(20)).toBe(false);
    expect(canAddStep(21)).toBe(false);
  });
});

describe("CR-121 c17b · xuất bản vN+1, chế độ xem", () => {
  test("nextVersion", () => {
    expect(nextVersion(null)).toBe(1);
    expect(nextVersion(undefined)).toBe(1);
    expect(nextVersion(2)).toBe(3);
  });
  test("Danh sách = Form, Sơ đồ = canvas, hai chiều khớp nhau", () => {
    expect(editorModeOf("list")).toBe("form");
    expect(editorModeOf("canvas")).toBe("canvas");
    expect(viewModeOf("form")).toBe("list");
    expect(viewModeOf(editorModeOf("list"))).toBe("list");
  });
  test("'Chỉ chạy khi' bằng lời nghiệp vụ, không điều kiện ⇒ null (Luôn chạy)", () => {
    const when = { op: "and", conds: [{ field: "total_value", op: "ge", value: 500_000_000 }] };
    expect(describeWhen(when as never)).toContain("500 tr");
    expect(describeWhen(null)).toBeNull();
  });
});
