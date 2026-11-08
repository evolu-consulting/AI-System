// CR-125 · cr125-request-steps · RunStepActions dùng chung: task duyệt ⇒ nút theo `FlowTask.actions` (nhãn từ hub); task form ⇒ KHÔNG nút
// quyết (bước form tự có «Gửi»); không có task ⇒ không có khối hành động.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FlowTask, FlowView } from "@ai/contracts/flow";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { decisionTaskOf, RunStepActions } from "./RunStepActions";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const T = "4d400000-0000-4000-8000-000000000002";
const fb = { kind: "feedback" as const, required: true, max_len: 4000 };
const review: FlowTask = {
  task_id: T,
  step_key: "k1",
  kind: "review",
  actions: [
    { key: "approve", label: "Duyệt", style: "primary", confirm: false, input: { kind: "none" } },
    { key: "return", label: "Trả lại", style: "default", confirm: false, input: fb },
    { key: "reject", label: "Từ chối", style: "danger", confirm: true, input: fb },
  ],
};
const formTask: FlowTask = {
  task_id: T,
  step_key: "k0",
  kind: "form",
  actions: [
    { key: "submit", label: "Gửi", style: "primary", confirm: false, input: { kind: "none" } },
  ],
};
const view = (tasks: FlowTask[]): FlowView => ({
  slot: "processes.request",
  ref: "r1",
  run: null,
  state: "running",
  phase: null,
  note: null,
  attention: null,
  block_reason: null,
  steps: [],
  tasks,
});
const html = (tasks: FlowTask[]) =>
  renderToStaticMarkup(
    <RunStepActions
      slot="processes.request"
      refId="r1"
      view={view(tasks)}
      onSubmitForm={async () => {}}
      onDecide={async () => {}}
    />,
  );

describe("RunStepActions", () => {
  test("task duyệt ⇒ đủ Duyệt / Trả lại / Từ chối theo hành động của hub", () => {
    const out = html([review]);
    for (const k of ["approve", "return", "reject"])
      expect(out).toContain(`data-testid="request-${k}"`);
    expect(out).toContain("Trả lại");
  });
  test("task form ⇒ không có nút quyết ở đây (bước form tự vẽ «Gửi»)", () => {
    expect(decisionTaskOf(view([formTask]))).toBeNull();
    expect(html([formTask])).not.toContain("request-task");
  });
  test("không có task ⇒ không có khối hành động", () => {
    expect(html([])).not.toContain("request-task");
  });
});
