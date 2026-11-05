// hub-routing-backfill · unit: nhãn "Đang dùng" từ `current_def_id` của GET routing.
import { describe, expect, test } from "bun:test";
import { routingCurrent } from "./routing-current";

const P = [{ def_id: "a" }, { def_id: "b" }];

describe("routingCurrent", () => {
  test("đang dùng nằm trong tập gán ⇒ gắn nhãn hàng đó", () => {
    expect(routingCurrent({ processes: P, current_def_id: "b" })).toEqual({
      markId: "b",
      outside: null,
    });
  });
  test("đang dùng ngoài tập (mặc định khe) ⇒ dòng riêng kèm tên", () => {
    expect(
      routingCurrent({ processes: P, current_def_id: "d", current_def_name: "Mặc định" }),
    ).toEqual({ markId: null, outside: { defId: "d", name: "Mặc định" } });
  });
  test("server cũ (vắng) / chưa có quy trình ⇒ không gì", () => {
    const none = { markId: null, outside: null };
    expect(routingCurrent({ processes: P })).toEqual(none);
    expect(routingCurrent({ processes: [], current_def_id: null })).toEqual(none);
  });
});
