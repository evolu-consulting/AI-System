// CR-134 · khuôn loading: lần đầu ⇒ first; có dữ liệu cũ và đang tải lại ⇒ refreshing (giữ dữ liệu, chỉ báo).
import { describe, expect, test } from "bun:test";
import { loadPhase } from "./load-phase";

const q = (o: Partial<Parameters<typeof loadPhase>[0]>) => ({
  isPending: false,
  isFetching: false,
  isError: false,
  data: undefined as unknown,
  ...o,
});

describe("loadPhase", () => {
  test("chưa có dữ liệu + đang tải ⇒ first", () => {
    expect(loadPhase(q({ isPending: true, isFetching: true }))).toBe("first");
  });
  test("có dữ liệu + đang tải lại ⇒ refreshing, xong ⇒ idle", () => {
    expect(loadPhase(q({ data: { n: 1 }, isFetching: true }))).toBe("refreshing");
    expect(loadPhase(q({ data: { n: 1 } }))).toBe("idle");
  });
  test("lỗi không có dữ liệu ⇒ error; lỗi nhưng còn dữ liệu cũ ⇒ vẫn hiện dữ liệu", () => {
    expect(loadPhase(q({ isError: true }))).toBe("error");
    expect(loadPhase(q({ isError: true, data: 1 }))).toBe("idle");
  });
  test("tắt (enabled=false): không pending, không dữ liệu ⇒ idle", () => {
    expect(loadPhase(q({}))).toBe("idle");
  });
});
