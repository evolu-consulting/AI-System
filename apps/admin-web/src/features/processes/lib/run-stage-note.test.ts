// ADM-FR-67 · P-d2 · D2-45 (UAT P-d1 B5): ghi chú hẹn giờ dưới ô "Giai đoạn" của danh sách lượt chạy.
import { describe, expect, test } from "bun:test";
import { runStageNote } from "./run-stage-note";

describe("runStageNote", () => {
  test("chờ ngày ⇒ khoá waitUntil với ngày giờ theo múi giờ người xem", () => {
    const n = runStageNote({ wait_until: "2026-11-17T02:00:00.000Z" }, "Asia/Ho_Chi_Minh", "vi");
    expect(n).toEqual({
      key: "process.admin.editor.runs.waitUntil",
      params: { date: "17/11/2026 09:00" },
    });
    expect(runStageNote({ wait_until: "2026-11-17T02:00:00.000Z" }, "UTC", "en")?.params).toEqual({
      date: "2026-11-17 02:00",
    });
  });
  test("thử lại ⇒ khoá retryAt chỉ giờ; không hẹn ⇒ null", () => {
    expect(
      runStageNote({ retry_at: "2026-11-17T03:42:00.000Z" }, "Asia/Ho_Chi_Minh", "vi"),
    ).toEqual({
      key: "process.admin.editor.runs.retryAt",
      params: { time: "10:42" },
    });
    expect(runStageNote({ wait_until: null, retry_at: null }, "UTC", "vi")).toBeNull();
    expect(runStageNote({}, "UTC", "vi")).toBeNull();
  });
});
