// HUB-FR-105 · HUB-FR-112 · HUB-FR-113 · contract P-a (bổ sung cho acceptance R-K*): chuỗi SSE, luật chéo stage, khoá thừa.
import { describe, expect, test } from "bun:test";
import { processDefStagePaths } from "../hub-admin/processes";
import {
  CreateProcessRunRequestSchema,
  parseMeStreamProcessEvent,
  RoomFlowRecentSchema,
  RoomProcessPartSchema,
} from "./index";

const ID = "00000000-0000-4000-8000-0000000a0101";

describe("P-a contract", () => {
  test("parseMeStreamProcessEvent nhận chuỗi JSON SSE; JSON hỏng ⇒ null", () => {
    const data = JSON.stringify({ task_id: ID, result: "pass" });
    expect(parseMeStreamProcessEvent("review_task.closed", data)?.event).toBe("review_task.closed");
    expect(parseMeStreamProcessEvent("review_task.closed", "{")).toBeNull();
  });

  test("processDefStagePaths: key trùng, real_action ở stage 0 / sau auto", () => {
    const st = (key: string, after: "review" | "auto", real_action = false) =>
      ({
        key,
        after: after === "review" ? { kind: "review", group_id: null } : { kind: "auto" },
        real_action,
      }) as never;
    expect(
      processDefStagePaths([st("a", "review", true), st("a", "auto"), st("c", "review", true)]),
    ).toEqual(["stages.0.real_action", "stages.1.key", "stages.2.real_action"]);
    expect(processDefStagePaths([st("a", "review"), st("b", "auto", true)])).toEqual([]);
  });

  test("input trim; run_end status lạ ⇒ fail; FlowRecent nhận process.kind", () => {
    const b = CreateProcessRunRequestSchema.parse({
      process_key: "sdlc",
      input: "  x  ",
      origin: { kind: "none" },
    });
    expect(b.input).toBe("x");
    const end = { kind: "run_end", process_run_id: ID, status: "running", actor: null };
    expect(RoomProcessPartSchema.safeParse(end).success).toBe(false);
    const recent = {
      id: ID,
      seq: 1,
      sender_type: "process",
      sender: { id: ID, display_name: "Hoá đơn" },
      preview: "x",
      created_at: "2026-10-10T01:00:00.000Z",
      unread: false,
      process: { kind: "output" },
    };
    expect(RoomFlowRecentSchema.safeParse(recent).success).toBe(true);
  });
});
