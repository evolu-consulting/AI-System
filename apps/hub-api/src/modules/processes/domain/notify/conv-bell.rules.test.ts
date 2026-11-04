// dlc-bell · chuông hội thoại: kind `process.<kind>`, tiêu đề kèm tên quy trình, khoá chống trùng = id notice.
import { expect, test } from "bun:test";
import { convBellsOf } from "./pack-bell.rules";

const row = (payload: Record<string, unknown>) => ({
  id: "n1",
  userId: "u1",
  processRunId: "r1",
  payload,
});

test("cần duyệt ⇒ process.review_requested, tiêu đề bước — quy trình", () => {
  const [b] = convBellsOf("review_requested", [
    row({ process_name: "DLC · Bug Fix", stage_name: "Báo cáo · duyệt deploy" }),
  ]);
  expect(b).toEqual({
    run_id: "r1",
    user_id: "u1",
    kind: "process.review_requested",
    title: "Cần duyệt: Báo cáo · duyệt deploy — DLC · Bug Fix",
    dedup_key: "n1",
  });
});

test("cần quyết, không tên bước ⇒ tiêu đề theo tên quy trình (không lặp)", () => {
  const [b] = convBellsOf("decision_requested", [row({ process_name: "DLC · Bug Fix" })]);
  expect(b?.title).toBe("Cần quyết định: DLC · Bug Fix");
  expect(b?.kind).toBe("process.decision_requested");
});
