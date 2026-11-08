// CR-126 · cr126-child-task-visible-2 · «Việc chờ tôi» không nói «chưa có việc» khi đang tải / lỗi.
import { describe, expect, it } from "bun:test";
import type { ReviewTaskListResponse } from "@ai/contracts/chat";
import { waitingView } from "./waiting";

const item = (status: string, can_act: boolean) =>
  ({ task: { id: `${status}-${can_act}`, status, can_act }, process_run: {} }) as never;
const data = (items: unknown[]): ReviewTaskListResponse =>
  ({ items, open_count: items.length, next_cursor: null }) as never;

describe("waitingView", () => {
  it("đang tải ⇒ loading (không phải «chưa có việc»)", () => {
    expect(waitingView({ isPending: true, isError: false }).kind).toBe("loading");
  });
  it("lỗi ⇒ error", () => {
    expect(waitingView({ isPending: false, isError: true }).kind).toBe("error");
  });
  it("tải xong, không có việc làm được ⇒ empty", () => {
    const q = { isPending: false, isError: false, data: data([item("open", false)]) };
    expect(waitingView(q).kind).toBe("empty");
  });
  it("tải xong ⇒ chỉ việc mở mà tôi làm được", () => {
    const q = {
      isPending: false,
      isError: false,
      data: data([item("open", true), item("closed", true), item("open", false)]),
    };
    const v = waitingView(q);
    expect(v.kind === "list" ? v.items.map((i) => i.task.id) : []).toEqual(["open-true"]);
  });
});
