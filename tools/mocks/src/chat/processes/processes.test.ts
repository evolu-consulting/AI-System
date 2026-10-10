// HUB-FR-105…117 · CR-056 · mock quy trình P-a (plan-step0 §3): fixture khớp contract, view theo persona, hành động,
// `/__mock/process` phát `room.message`, `/__mock/reset`.
import { beforeEach, describe, expect, test } from "bun:test";
import {
  ProcessInboxResponseSchema,
  ProcessListResponseSchema,
  ProcessRunListResponseSchema,
  ProcessRunUsageSchema,
  ProcessRunViewSchema,
  ReviewTaskListResponseSchema,
  RoomDetailSchema,
  RoomMessagePageSchema,
  TaskDetailSchema,
} from "@ai/contracts/chat";
import { createChatMock } from "../index";
import { PA_FIX } from "./index";

const app = createChatMock({ fast: true, flowIdleS: 600, eventsRetentionS: 600 });

async function token(username: string): Promise<string> {
  const body = JSON.stringify({ tenant_key: "acme", username, password: "dev-password-1" });
  const init = { method: "POST", headers: { "content-type": "application/json" }, body };
  return ((await (await app.request("/auth/login", init)).json()) as { access_token: string })
    .access_token;
}
async function call(user: string, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(user)}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}
const control = (body: unknown) =>
  app.request("/__mock/process", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const RUNS = [
  PA_FIX.runRunning,
  PA_FIX.runReview,
  PA_FIX.runAsk,
  PA_FIX.runDecision,
  PA_FIX.runDone,
  PA_FIX.runCancelled,
];

beforeEach(async () => {
  await app.request("/__mock/reset", { method: "POST" });
});

describe("fixture khớp contract", () => {
  test("6 run đủ trạng thái; view mọi persona parse; catalog + list parse", async () => {
    const statuses = [];
    for (const id of RUNS) {
      const v = await call("lan", "GET", `/process-runs/${id}`);
      expect(ProcessRunViewSchema.parse(v.json).access).toBe("full");
      statuses.push(v.json.status);
      for (const u of ["hoa", "tam", "cuc", "q01", "q02", "tadmin"]) {
        const r = await call(u, "GET", `/process-runs/${id}`);
        if (r.status === 200) ProcessRunViewSchema.parse(r.json);
        else expect(r.status).toBe(404);
      }
    }
    expect(statuses).toEqual([
      "running",
      "waiting_review",
      "waiting_answer",
      "needs_decision",
      "done",
      "cancelled",
    ]);
    ProcessListResponseSchema.parse((await call("lan", "GET", "/processes")).json);
    const list = ProcessRunListResponseSchema.parse(
      (await call("lan", "GET", `/process-runs?room_id=${PA_FIX.room}`)).json,
    );
    expect(list.items).toHaveLength(6);
  });
});

describe("fixture thread phòng R", () => {
  test("thread phòng R đủ 7 kind, tin parse RoomMessage; khối gốc có flow.recent", async () => {
    const main = RoomMessagePageSchema.parse(
      (await call("hoa", "GET", `/rooms/${PA_FIX.room}/messages`)).json,
    );
    expect(main.items).toHaveLength(6);
    expect(main.items[0]?.flow?.recent?.length).toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (const id of RUNS) {
      const page = await call(
        "hoa",
        "GET",
        `/rooms/${PA_FIX.room}/messages?flow_id=${PA_FIX.flow(id)}`,
      );
      for (const m of RoomMessagePageSchema.parse(page.json).items)
        kinds.add(m.process?.kind ?? "");
    }
    expect([...kinds].sort()).toEqual([
      "ask",
      "decision",
      "forward",
      "output",
      "run_end",
      "task_result",
    ]);
    RoomDetailSchema.parse((await call("lan", "GET", `/rooms/${PA_FIX.room}`)).json);
    expect((await call("cuc", "GET", `/rooms/${PA_FIX.room}`)).status).toBe(404);
  });
});

describe("persona", () => {
  test("T (ngoài phòng, Group Kế toán) ⇒ access task + task review can_act; X ⇒ full, không có task", async () => {
    const t = await call("cuc", "GET", `/process-runs/${PA_FIX.runReview}`);
    expect(t.json.access).toBe("task");
    expect(t.json.my_tasks[0].can_act).toBe(true);
    const x = await call("tam", "GET", `/process-runs/${PA_FIX.runReview}`);
    expect(x.json.my_tasks).toEqual([]);
    expect(x.json.open_tasks[0].group.name).toBe("Kế toán");
    expect(x.json.thread).toEqual({ room_id: PA_FIX.room, flow_id: PA_FIX.flow(PA_FIX.runReview) });
  });

  test("lan-left: access task, my_tasks rỗng, outputs ≥1, can_cancel, không thread", async () => {
    await control({ action: "leave" });
    const v = await call("lan", "GET", `/process-runs/${PA_FIX.runReview}`);
    expect(v.json).toMatchObject({ access: "task", my_tasks: [], can_cancel: true });
    expect(v.json.outputs.length).toBeGreaterThan(0);
    expect(v.json.thread).toBeUndefined();
  });

  test("usage: A full, T summary", async () => {
    const a = ProcessRunUsageSchema.parse(
      (await call("lan", "GET", `/process-runs/${PA_FIX.runDone}/usage`)).json,
    );
    expect(a.stages[1]?.team_runs[0]?.calls).toHaveLength(4);
    const t = ProcessRunUsageSchema.parse(
      (await call("cuc", "GET", `/process-runs/${PA_FIX.runDone}/usage`)).json,
    );
    expect(t.detail).toBe("summary");
    expect(t.stages.every((s) => s.calls.length === 0)).toBe(true);
  });
});

describe("hành động", () => {
  test("review: fail thiếu feedback ⇒ 422; pass ⇒ TaskDetail closed, run sang stage 1", async () => {
    const path = `/review-tasks/${PA_FIX.taskReview}/decision`;
    expect((await call("hoa", "POST", path, { result: "fail" })).status).toBe(422);
    const ok = await call("hoa", "POST", path, { result: "pass" });
    expect(TaskDetailSchema.parse(ok.json).status).toBe("closed");
    expect((await call("hoa", "POST", path, { result: "pass" })).json.error.code).toBe(
      "REVIEW_TASK_CLOSED",
    );
    expect(
      (await call("lan", "GET", `/process-runs/${PA_FIX.runReview}`)).json.current_stage_idx,
    ).toBe(1);
  });

  test("ask: chuỗi chuyển đã 2 ⇒ chuyển thêm 1 được, lần 4 FORWARD_LIMIT; trả lời ⇒ running", async () => {
    const fwd = `/review-tasks/${PA_FIX.taskAsk}/forward`;
    const tam = (await call("tam", "GET", `/process-runs/${PA_FIX.runAsk}`)).json.started_by;
    expect(tam).toBeTruthy();
    const r3 = await call("q02", "POST", fwd, { to_user_id: PA_FIX.persona.X });
    expect(r3.json.forwards).toHaveLength(3);
    expect((await call("tam", "POST", fwd, { to_user_id: PA_FIX.persona.T })).json.error.code).toBe(
      "FORWARD_LIMIT",
    );
    await call("q01", "POST", `/review-tasks/${PA_FIX.taskAsk}/answer`, { answer: "Tháng 10" });
    expect((await call("lan", "GET", `/process-runs/${PA_FIX.runAsk}`)).json.status).toBe(
      "running",
    );
  });
});

describe("hành động run", () => {
  test("decide + cancel: quyền + trạng thái", async () => {
    expect(
      (
        await call("tam", "POST", `/process-runs/${PA_FIX.runDecision}/decide`, {
          option: "cancel",
        })
      ).status,
    ).toBe(403);
    const d = await call("lan", "POST", `/process-runs/${PA_FIX.runDecision}/decide`, {
      option: "use_current",
    });
    expect(ProcessRunViewSchema.parse(d.json).status).toBe("running");
    expect((await call("lan", "POST", `/process-runs/${PA_FIX.runDone}/cancel`, {})).status).toBe(
      409,
    );
    expect(
      (await call("hoa", "POST", `/process-runs/${PA_FIX.runRunning}/cancel`, {})).status,
    ).toBe(403);
  });

  test("POST /process-runs: 201 + header; key lạ ⇒ PROCESS_NOT_FOUND{suggestions}", async () => {
    const r = await call("lan", "POST", "/process-runs", {
      process_key: "hoa-don",
      input: "HD-99",
      origin: { kind: "room", room_id: PA_FIX.room },
    });
    expect(r.status).toBe(201);
    expect(r.headers.get("X-Process-Run-Id")).toBe(r.json.id);
    const bad = await call("lan", "POST", "/process-runs", {
      process_key: "hoa",
      input: "",
      origin: { kind: "none" },
    });
    expect(bad.json.error).toMatchObject({
      code: "PROCESS_NOT_FOUND",
      details: { suggestions: ["hoa-don"] },
    });
  });
});

describe("inbox", () => {
  test("inbox + review-tasks parse; đọc hết ⇒ unread 0", async () => {
    const tasks = ReviewTaskListResponseSchema.parse(
      (await call("cuc", "GET", "/me/review-tasks")).json,
    );
    expect(tasks.open_count).toBeGreaterThan(0);
    const inbox = ProcessInboxResponseSchema.parse(
      (await call("cuc", "GET", "/me/process-inbox")).json,
    );
    const read = await call("cuc", "POST", "/me/process-inbox/read", {
      up_to_id: inbox.items[0]?.id,
    });
    expect(read.json).toEqual({ unread: 0 });
  });
});

describe("/__mock/process + /me/stream", () => {
  test("output ⇒ B nhận room.message tin process + review_task.created", async () => {
    const res = await app.request("/me/stream", {
      headers: { Authorization: `Bearer ${await token("hoa")}` },
    });
    const reader = res.body?.getReader();
    await reader?.read(); // ping
    expect((await control({ run_id: PA_FIX.runRunning, action: "output" })).status).toBe(204);
    let text = "";
    while (!(text.includes("review_task.created") && text.includes("room.message")))
      text += new TextDecoder().decode((await reader?.read())?.value);
    await reader?.cancel();
    expect(text).toContain("event: room.message");
    expect(text).toContain('"sender_type":"process"');
    expect((await control({ run_id: PA_FIX.runDone, action: "advance" })).status).toBe(409);
  });
});
