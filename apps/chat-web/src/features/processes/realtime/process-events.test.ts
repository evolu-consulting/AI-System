// HUB-FR-112 · P-a Bước 0: sự kiện quy trình → cache (patch view, invalidate, reset).
import { describe, expect, test } from "bun:test";
import type { ProcessRunView } from "@ai/contracts/chat";
import { QueryClient } from "@tanstack/react-query";
import { processKeys } from "../shared/keys";
import {
  onProcessRoomMessage,
  patchRunView,
  resetProcessCache,
  routeProcessEvent,
} from "./process-events";

const RUN = "00000000-0000-4000-8000-000000000001";
const full = {
  access: "full",
  id: RUN,
  status: "running",
  current_stage_idx: 0,
} as unknown as ProcessRunView;

describe("patchRunView", () => {
  test("view full: vá status + current_stage_idx", () => {
    const v = patchRunView(full, { status: "waiting_review", stage_idx: 2 });
    expect(v).toMatchObject({ status: "waiting_review", current_stage_idx: 2 });
  });
  test("view task: chỉ vá status; chưa có view ⇒ undefined", () => {
    const task = { access: "task", id: RUN, status: "running" } as unknown as ProcessRunView;
    expect(patchRunView(task, { status: "done", stage_idx: 1 })).toEqual({
      ...task,
      status: "done",
    });
    expect(patchRunView(undefined, { status: "done", stage_idx: 1 })).toBeUndefined();
  });
});

describe("routeProcessEvent", () => {
  test("process.updated vá cache ngay", () => {
    const client = new QueryClient();
    client.setQueryData(processKeys.run(RUN), full);
    routeProcessEvent(client, {
      event: "process.updated",
      data: { process_run_id: RUN, status: "waiting_answer", stage_idx: 1 },
    });
    expect(client.getQueryData<ProcessRunView>(processKeys.run(RUN))).toMatchObject({
      status: "waiting_answer",
      current_stage_idx: 1,
    });
  });
  test("process.updated cho run chưa có trong cache không tạo query rác", () => {
    const client = new QueryClient();
    routeProcessEvent(client, {
      event: "process.updated",
      data: { process_run_id: RUN, status: "done", stage_idx: 0 },
    });
    expect(client.getQueryData(processKeys.run(RUN))).toBeUndefined();
  });
});

describe("resetProcessCache / onProcessRoomMessage", () => {
  test("stream.reset invalidate dữ liệu quy trình nhưng giữ cờ engine", () => {
    const client = new QueryClient();
    client.setQueryData(processKeys.engine, "on");
    client.setQueryData(processKeys.run(RUN), full);
    resetProcessCache(client);
    expect(client.getQueryState(processKeys.run(RUN))?.isInvalidated).toBe(true);
    expect(client.getQueryState(processKeys.engine)?.isInvalidated).toBe(false);
  });
  test("tin process kind=block không invalidate; kind khác thì có", () => {
    const client = new QueryClient();
    client.setQueryData(processKeys.run(RUN), full);
    onProcessRoomMessage(client, { process_run_id: RUN, process: { kind: "block" } });
    expect(client.getQueryState(processKeys.run(RUN))?.isInvalidated).toBe(false);
    onProcessRoomMessage(client, { process_run_id: RUN, process: { kind: "output" } });
    // chưa có observer đang dùng (refetchType active) nhưng query vẫn bị đánh dấu cũ
    expect(client.getQueryState(processKeys.run(RUN))?.isInvalidated).toBe(true);
  });
});
