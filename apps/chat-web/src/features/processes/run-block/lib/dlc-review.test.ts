// platform/gd0_dlc_fix · luật duyệt DLC trong chat: chỉ run `dlc-*`, task review mở, Từ chối quay lại bước cấu hình gần nhất.
import { expect, test } from "bun:test";
import type { ProcessRunView, StageView } from "@ai/contracts/chat";
import { dlcReviewTarget, isDlcProcess, rejectStepOf } from "./dlc-review";

const stage = (idx: number, name: string, back: number[], out: string | null = null) =>
  ({
    idx,
    step: idx,
    name,
    back_to_steps: back,
    current_output_id: out,
  }) as unknown as StageView;

const OUT = "00000000-0000-4000-8000-000000000001";
const TASK = "00000000-0000-4000-8000-0000000000aa";

const view = (over: Record<string, unknown> = {}) =>
  ({
    access: "full",
    process: { key: "dlc-bug-fix", name: "DLC · Bug Fix", version: 1 },
    stages: [
      stage(0, "Khởi tạo", []),
      stage(1, "Phân tích lỗi + plan", [], OUT),
      stage(2, "Test case", [1]),
      stage(3, "Build", []),
      stage(4, "Báo cáo", [1, 3]),
    ],
    my_tasks: [],
    open_tasks: [{ id: TASK, kind: "review", stage_idx: 1, assignees: [], group: null }],
    ...over,
  }) as unknown as ProcessRunView;

test("chỉ quy trình key dlc-*", () => {
  expect(isDlcProcess("dlc-bug-fix")).toBe(true);
  expect(isDlcProcess("approve-leave")).toBe(false);
  expect(dlcReviewTarget(view({ process: { key: "leave", name: "x", version: 1 } }))).toBeNull();
});

test("bước không cấu hình quay lại ⇒ làm lại chính bước đang duyệt", () => {
  const r = dlcReviewTarget(view());
  expect(r?.taskId).toBe(TASK);
  expect(r?.outputId).toBe(OUT);
  expect(r?.backToStep).toBeUndefined();
  expect(r?.backStepName).toBe("Phân tích lỗi + plan");
});

test("có cấu hình ⇒ quay lại bước gần nhất (lớn nhất) trong back_to_steps", () => {
  expect(rejectStepOf(stage(4, "Báo cáo", [1, 3]))).toBe(3);
  const r = dlcReviewTarget(
    view({ open_tasks: [{ id: TASK, kind: "review", stage_idx: 2, assignees: [], group: null }] }),
  );
  expect(r?.backToStep).toBe(1);
  expect(r?.backStepName).toBe("Phân tích lỗi + plan");
});

test("task của tôi thắng task mở chung; không có review mở ⇒ null", () => {
  const mine = { id: "mine", kind: "review", status: "open", stage_idx: 1 };
  expect(dlcReviewTarget(view({ my_tasks: [mine] }))?.taskId).toBe("mine");
  expect(dlcReviewTarget(view({ open_tasks: [] }))).toBeNull();
  expect(dlcReviewTarget(view({ access: "summary" }))).toBeNull();
  expect(dlcReviewTarget(undefined)).toBeNull();
});
